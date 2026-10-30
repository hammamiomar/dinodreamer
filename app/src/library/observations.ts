// observations/<block>.bin: one record per listed image of a block.
//
// Packed little-endian records of 3,409 bytes, unaligned:
//   offset 0     image_id  int64
//   offset 8     block     int64
//   offset 16    codes     float32 [261, 3]   gain-free code of every token slot
//   offset 3148  gated     bool [261]         the slot ranked this block in its top K
// Axes: T token slots (0 CLS, 1–4 storage, 5–260 patches), R rank (3).
// Records are unaligned, so values are read through a DataView and copied.

import { TOKEN_SLOTS } from "../recipe";
import type { Code, TokenResponses } from "./records";

export const RECORD_BYTES = 3409;
const RANK = 3;
const CODES_OFFSET = 16;
const GATED_OFFSET = CODES_OFFSET + TOKEN_SLOTS * RANK * 4;

/** One decoded record: every token slot's code and top-K flag for one image in one block. */
export interface ObservationRecord {
  imageId: number;
  block: number;
  codes_TR: Float32Array;
  gated_T: Uint8Array;
}

/**
 * The records of one block, indexed by image. Construction checks the length,
 * the block of every record and that image ids are exact; records decode on demand.
 */
export class ObservationBundle {
  readonly block: number;
  /** Ascending, as stored. */
  readonly imageIds: number[];
  private readonly view: DataView;
  private readonly rowOfImage = new Map<number, number>();

  constructor(buffer: ArrayBuffer, block: number) {
    if (buffer.byteLength % RECORD_BYTES !== 0) {
      throw new Error(`observations for basis group ${block}: ${buffer.byteLength} bytes is not a whole number of records`);
    }
    this.block = block;
    this.view = new DataView(buffer);
    this.imageIds = [];
    for (let row = 0; row < buffer.byteLength / RECORD_BYTES; row++) {
      const offset = row * RECORD_BYTES;
      const imageId = exactInteger(this.view.getBigInt64(offset, true));
      const recordBlock = exactInteger(this.view.getBigInt64(offset + 8, true));
      if (imageId === null) throw new Error(`observations for basis group ${block}: record ${row} has an inexact image id`);
      if (recordBlock !== block) throw new Error(`observations for basis group ${block}: record ${row} belongs to basis group ${recordBlock}`);
      this.imageIds.push(imageId);
      this.rowOfImage.set(imageId, row);
    }
  }

  has(imageId: number): boolean {
    return this.rowOfImage.has(imageId);
  }

  /** The image's record, or null if this block saved none for it. */
  record(imageId: number): ObservationRecord | null {
    const row = this.rowOfImage.get(imageId);
    if (row === undefined) return null;
    return { imageId, block: this.block, ...recordValues(this.view, row * RECORD_BYTES) };
  }
}

/**
 * One record read alone (a range read of the bundle, library.ts): checks its
 * length, its block and that its image id is exact, as the bundle does.
 */
export function decodeObservationRecord(buffer: ArrayBuffer, block: number): ObservationRecord {
  if (buffer.byteLength !== RECORD_BYTES) throw new Error(`an observation record of basis group ${block} is ${buffer.byteLength} bytes, not ${RECORD_BYTES}`);
  const view = new DataView(buffer);
  const imageId = exactInteger(view.getBigInt64(0, true));
  const recordBlock = exactInteger(view.getBigInt64(8, true));
  if (imageId === null) throw new Error(`an observation record of basis group ${block} has an inexact image id`);
  if (recordBlock !== block) throw new Error(`an observation record read for basis group ${block} belongs to basis group ${recordBlock}`);
  return { imageId, block, ...recordValues(view, 0) };
}

/** The codes and top-K flags of the record that starts at `offset`. */
function recordValues(view: DataView, offset: number): Pick<ObservationRecord, "codes_TR" | "gated_T"> {
  const codes_TR = new Float32Array(TOKEN_SLOTS * RANK);
  for (let index = 0; index < codes_TR.length; index++) {
    codes_TR[index] = view.getFloat32(offset + CODES_OFFSET + index * 4, true);
  }
  const gated_T = new Uint8Array(view.buffer.slice(view.byteOffset + offset + GATED_OFFSET, view.byteOffset + offset + GATED_OFFSET + TOKEN_SLOTS));
  return { codes_TR, gated_T };
}

/** The recorded code of one token slot. */
export function recordedCode(record: ObservationRecord, slot: number): Code {
  const at = slot * RANK;
  return [record.codes_TR[at]!, record.codes_TR[at + 1]!, record.codes_TR[at + 2]!];
}

/**
 * Response norm and top-K flag of every slot, as the producer computes them:
 * NumPy's float32 norm rounds the square, the sum and the root to float32 in
 * that order, so these match the norms in atlas cards exactly.
 */
export function recordResponses(record: ObservationRecord): TokenResponses {
  const norm: number[] = [];
  const gated: boolean[] = [];
  for (let slot = 0; slot < TOKEN_SLOTS; slot++) {
    const [x, y, z] = recordedCode(record, slot);
    const sum = Math.fround(Math.fround(Math.fround(x * x) + Math.fround(y * y)) + Math.fround(z * z));
    norm.push(Math.fround(Math.sqrt(sum)));
    gated.push(record.gated_T[slot] === 1);
  }
  return { norm, gated };
}

function exactInteger(value: bigint): number | null {
  const converted = Number(value);
  return Number.isSafeInteger(converted) ? converted : null;
}
