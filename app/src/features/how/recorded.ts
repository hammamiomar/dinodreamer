// How's recorded numbers (engine/tools/prepare_how_records.py and prepare_how_grids.mjs): the
// decoders of their files. Each decoder checks the file's tag and size once, at the boundary,
// and returns the numbers in the shapes the live engine returns, so a figure never knows which
// source it reads. The formats are stated in the two scripts' headers.

import { PATCHES, TOKENS, WIDTH } from "./how-shapes";

const WINNERS = 32;
/** The μ of the streams' μ-law code. */
const MU = 255;

/** What record.json holds beyond the files: the picture, the provenance and the overview. */
export interface RecordedPicture {
  imageId: number;
  slot: number;
  block: number;
  provenance: { recorded: string; encoder: string; dictionary: string; machine: string; calibrationScale: number; gain: number };
  /** Each token's norm at depth 0 (entering layer 1) to 12 (leaving layer 12), [13][261]. */
  tokenNorms: number[][];
  /** Each layer's update size per token, ‖after − before‖, [12][261]. */
  updateNorms: number[][];
}

function fail(file: string): never {
  throw new Error(`The recorded file ${file} is incomplete or malformed.`);
}

function tag(view: DataView, expected: string, file: string) {
  for (let index = 0; index < 4; index++) if (view.getUint8(index) !== expected.charCodeAt(index)) fail(file);
}

export function readRecord(value: unknown): RecordedPicture {
  const record = value as RecordedPicture & { format?: number };
  const rows = (table: unknown, count: number) =>
    Array.isArray(table) && table.length === count && table.every((row) => Array.isArray(row) && row.length === TOKENS && row.every(Number.isFinite));
  if (record?.format !== 1 || !Number.isSafeInteger(record.imageId) || !rows(record.tokenNorms, 13) || !rows(record.updateNorms, 12)) fail("record.json");
  return record;
}

/** A residual stream, [261 × 768]: 8-bit μ-law under the stage's range, the larger values exact. */
export function decodeStream(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  if (buffer.byteLength < 16) fail("stream");
  tag(view, "HST1", "stream");
  const [tokens, width, range, outliers] = [view.getUint16(4, true), view.getUint16(6, true), view.getFloat32(8, true), view.getUint32(12, true)];
  const values = tokens * width;
  if (tokens !== TOKENS || width !== WIDTH || !(range > 0) || buffer.byteLength !== 16 + values + 8 * outliers) fail("stream");
  const levels = new Int8Array(buffer, 16, values);
  const stream = new Float32Array(values);
  const step = Math.log1p(MU) / 127;
  for (let index = 0; index < values; index++) {
    const level = levels[index]!;
    stream[index] = Math.sign(level) * (range / MU) * Math.expm1(Math.abs(level) * step);
  }
  const at = 16 + values;
  for (let outlier = 0; outlier < outliers; outlier++) {
    stream[view.getUint32(at + 4 * outlier, true)] = view.getFloat32(at + 4 * (outliers + outlier), true);
  }
  return stream;
}

/** A layer's attention, the mean over its 12 heads, [261 × 261], row = query, column = key. */
export function decodeAttention(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  if (buffer.byteLength !== 8 + TOKENS * TOKENS) fail("attention");
  tag(view, "HAT1", "attention");
  if (view.getUint16(4, true) !== TOKENS) fail("attention");
  const levels = new Uint8Array(buffer, 8);
  return Float32Array.from(levels, (level) => (level / 255) ** 2);
}

/** The tokens after the final LayerNorm, [261 × 768], from float16. */
export function decodeFinal(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  if (buffer.byteLength !== 8 + 2 * TOKENS * WIDTH) fail("final");
  tag(view, "HFN1", "final");
  return Float32Array.from({ length: TOKENS * WIDTH }, (_, index) => half(view.getUint16(8 + 2 * index, true)));
}

/** Each patch's 32 winners, as the reader's read_image returns them (reader/protocol.ts ImageAddresses). */
export function decodeAddresses(buffer: ArrayBuffer): { blocks: Uint16Array; codes: Float32Array; norms: Float32Array } {
  const entries = PATCHES * WINNERS;
  const view = new DataView(buffer);
  if (buffer.byteLength !== 8 + entries * (2 + 12 + 4)) fail("addresses");
  tag(view, "HAD1", "addresses");
  if (view.getUint16(4, true) !== PATCHES || view.getUint16(6, true) !== WINNERS) fail("addresses");
  // Copies: the typed arrays need their own aligned buffers.
  const blocks = new Uint16Array(buffer.slice(8, 8 + 2 * entries));
  const codes = new Float32Array(buffer.slice(8 + 2 * entries, 8 + 14 * entries));
  const norms = new Float32Array(buffer.slice(8 + 14 * entries));
  return { blocks, codes, norms };
}

/** A material's grid at a tick, [side² × 16], from float16, with the tick and seed it was grown to. */
export function decodeGrid(buffer: ArrayBuffer): { side: number; tick: number; seed: number; state: Float32Array } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 16) fail("grid");
  tag(view, "HGR1", "grid");
  const [side, channels, tick, seed] = [view.getUint16(4, true), view.getUint16(6, true), view.getUint32(8, true), view.getUint32(12, true)];
  if (channels !== 16 || buffer.byteLength !== 16 + 2 * side * side * channels) fail("grid");
  const state = Float32Array.from({ length: side * side * channels }, (_, index) => half(view.getUint16(16 + 2 * index, true)));
  return { side, tick, seed, state };
}

/** IEEE half to number; recorded files hold finite values only. */
function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31;
  const mantissa = bits & 1023;
  if (exponent === 31) fail("float16 value");
  return sign * (exponent === 0 ? mantissa * 2 ** -24 : (1 + mantissa / 1024) * 2 ** (exponent - 15));
}
