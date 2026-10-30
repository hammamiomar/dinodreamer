// Where How's DINO and basis numbers come from: the recorded files of the page's one picture
// (recorded.ts, engine/tools/prepare_how_records.py) behind one interface, and the released
// collection's calibration and basis matrices. The automaton's record is automaton-record.ts.

import { AssetLoader, blockPath, fetchModelRelease, type ModelRelease } from "../../synthesis/assets";
import type { ReleaseLocation } from "../../synthesis/protocol";
import type { ImageAddresses } from "../../reader/protocol";
import type { GateReading } from "./how-engine-protocol";
import { LAYERS, PREFIX, RANK, WIDTH, WINNERS } from "./how-shapes";
import { decodeAddresses, decodeAttention, decodeFinal, decodeStream, readRecord, type RecordedPicture } from "./recorded";
import { readTensor } from "./safetensors";

/** The page's one picture: the hibiscus, its followed patch, and the basis group that patch selects. */
// Patch indices exclude DINO's five prefix tokens; the material stores token slot 59.
export const HOW_PICTURE = {
  imageId: 2985056820452196,
  patch: 54,
  block: 4009,
} as const;

/** Where a recorded picture's files live (engine/tools/prepare_how_records.py). */
export function recordedFolder(imageId: number): string {
  return `/how/recorded/picture-${imageId}/`;
}

/** A layer laid open. A recorded probe holds the mean over the 12 heads only (heads = 1). */
export interface DinoLayer {
  layer: number;
  before: Float32Array;
  after: Float32Array;
  /** [heads, 261, 261], row = query token. */
  attention: Float32Array;
  heads: 12 | 1;
}

/** Every depth at a glance: each token's norm at depths 0–12 and each layer's update size. */
export interface DinoOverview {
  /** [13][261]: entering layer 1 (depth 0), then leaving layer k (depth k). */
  tokenNorms: ArrayLike<number>[];
  /** [12][261]: ‖after − before‖ of each layer. */
  updateNorms: ArrayLike<number>[];
}

/** When and with what a source's numbers were computed: the page's status line shows both. */
export interface NumbersProvenance {
  /** ISO date. */
  date: string;
  /** "PyTorch 2.11.0 on the CPU, FP32", or the engine on this device's GPU. */
  machine: string;
}

export interface HowSource {
  readonly kind: "recorded" | "live";
  readonly provenance: NumbersProvenance;
  overview(): Promise<DinoOverview>;
  layer(layer: number): Promise<DinoLayer>;
  /** One layer's attention alone, [heads, 261, 261], for figures that need no residual stream. */
  attention(layer: number): Promise<{ attention: Float32Array; heads: 12 | 1 }>;
  /** [261, 768], the tokens after the final LayerNorm. */
  final(): Promise<Float32Array>;
  /** Each patch's 32 winners (reader/protocol.ts ImageAddresses, without the dictionary id). */
  addresses(): Promise<Pick<ImageAddresses, "blocks" | "codes" | "norms">>;
  /** A patch's token (0–255) through the gate. */
  gate(patch: number): Promise<GateReading>;
  /** [3, 768], a block's three directions. */
  frame(block: number): Promise<Float32Array>;
}

/** The release's dictionary files the recorded source reads: the calibration and one block's frame. */
export interface DictionaryFiles {
  calibration(): Promise<{ mean: Float32Array; scale: number }>;
  /** [3, 768]: the block file stores F [768, 3]; this is its transpose. */
  frame(block: number): Promise<Float32Array>;
}

/** The dictionary files of the release at `location`, read once each through the asset cache. */
export function releaseDictionary(location: ReleaseLocation): DictionaryFiles {
  let opened: Promise<{ release: ModelRelease; assets: AssetLoader }> | null = null;
  const open = () => (opened ??= (async () => {
    const release = await fetchModelRelease(location);
    const assets = new AssetLoader(location.baseUrl);
    await assets.open();
    return { release, assets };
  })());
  let calibration: Promise<{ mean: Float32Array; scale: number }> | null = null;
  const frames = new Map<number, Promise<Float32Array>>();
  return {
    calibration: () => (calibration ??= (async () => {
      const { release, assets } = await open();
      const bytes = await assets.bytes(release.calibration);
      return { mean: readTensor(bytes, "mean", [WIDTH]), scale: readTensor(bytes, "scale", [1])[0]! };
    })()),
    frame(block) {
      let frame = frames.get(block);
      if (!frame) {
        frame = (async () => {
          const { release, assets } = await open();
          const frame_DR = readTensor(await assets.bytes(blockPath(release, block)), "frame", [WIDTH, RANK]);
          return transpose(frame_DR, WIDTH, RANK);
        })();
        frames.set(block, frame);
      }
      return frame;
    },
  };
}

function transpose(values: Float32Array, rows: number, columns: number): Float32Array {
  const result = new Float32Array(values.length);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) result[column * rows + row] = values[row * columns + column]!;
  }
  return result;
}

async function binary(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The recorded file ${url} could not be read (${response.status}).`);
  return response.arrayBuffer();
}

/**
 * A recorded picture's numbers (engine/tools/prepare_how_records.py). Files load when a figure first
 * asks for them; the gate is rebuilt in the page from the recorded winners and codes, the final
 * tokens, the release's calibration and the winners' frames, by the gate's own formula.
 */
export function recordedSource(imageId: number, record: RecordedPicture, dictionary: DictionaryFiles, folder = recordedFolder(imageId)): HowSource {
  const once = <T>(load: () => Promise<T>) => {
    let value: Promise<T> | null = null;
    return () => (value ??= load());
  };
  const streams = new Map<number, Promise<Float32Array>>();
  const stream = (depth: number) => {
    let value = streams.get(depth);
    if (!value) {
      value = binary(`${folder}stream-${String(depth).padStart(2, "0")}.bin`).then(decodeStream);
      streams.set(depth, value);
    }
    return value;
  };
  const attentions = new Map<number, Promise<Float32Array>>();
  const attention = (layer: number) => {
    checkLayer(layer);
    let value = attentions.get(layer);
    if (!value) {
      value = binary(`${folder}attention-${String(layer + 1).padStart(2, "0")}.bin`).then(decodeAttention);
      attentions.set(layer, value);
    }
    return value;
  };
  const final = once(() => binary(`${folder}final.bin`).then(decodeFinal));
  const addresses = once(() => binary(`${folder}addresses.bin`).then(decodeAddresses));
  return {
    kind: "recorded",
    provenance: { date: record.provenance.recorded, machine: record.provenance.machine },
    overview: async () => ({ tokenNorms: record.tokenNorms, updateNorms: record.updateNorms }),
    async layer(layer) {
      checkLayer(layer);
      const [before, after, weights] = await Promise.all([stream(layer), stream(layer + 1), attention(layer)]);
      return { layer, before, after, attention: weights, heads: 1 };
    },
    attention: async (layer) => ({ attention: await attention(layer), heads: 1 }),
    final,
    addresses,
    async gate(patch) {
      const [tokens, read, calibration] = await Promise.all([final(), addresses(), dictionary.calibration()]);
      const token = tokens.subarray((PREFIX + patch) * WIDTH, (PREFIX + patch + 1) * WIDTH);
      const blocks = read.blocks.slice(patch * WINNERS, (patch + 1) * WINNERS);
      const codes = read.codes.slice(patch * WINNERS * RANK, (patch + 1) * WINNERS * RANK);
      const norms = read.norms.slice(patch * WINNERS, (patch + 1) * WINNERS);
      const frames = await Promise.all([...blocks].map((block) => dictionary.frame(block)));
      return gateFromWinners(token, calibration, blocks, codes, norms, frames, record.provenance.gain);
    },
    frame: (block) => dictionary.frame(block),
  };
}

/**
 * The gate's reading from known winners: x = s · (t − μ); x̂ = γ · Σ_k F_k c_k; the residual
 * ‖x − x̂‖ / ‖x‖ (engine/src/reader.rs, the gate).
 */
export function gateFromWinners(
  token: Float32Array,
  calibration: { mean: Float32Array; scale: number },
  blocks: Uint16Array,
  codes: Float32Array,
  norms: Float32Array,
  frames: readonly Float32Array[],
  gain: number,
): GateReading {
  const calibrated = Float32Array.from(token, (value, channel) => calibration.scale * (value - calibration.mean[channel]!));
  const reconstruction = new Float32Array(WIDTH);
  frames.forEach((frame_RD, winner) => {
    for (let direction = 0; direction < RANK; direction++) {
      const weight = gain * codes[winner * RANK + direction]!;
      for (let channel = 0; channel < WIDTH; channel++) reconstruction[channel]! += weight * frame_RD[direction * WIDTH + channel]!;
    }
  });
  let missed = 0;
  let size = 0;
  for (let channel = 0; channel < WIDTH; channel++) {
    missed += (calibrated[channel]! - reconstruction[channel]!) ** 2;
    size += calibrated[channel]! ** 2;
  }
  return { calibrated, blocks, codes, norms, gain, reconstruction, residual: Math.sqrt(missed / size) };
}

function checkLayer(layer: number) {
  if (!Number.isInteger(layer) || layer < 0 || layer >= LAYERS) throw new Error(`DINO has layers 0 to ${LAYERS - 1}.`);
}

/** Read a recorded picture's record.json. */
export async function loadRecord(imageId: number): Promise<RecordedPicture> {
  const response = await fetch(`${recordedFolder(imageId)}record.json`);
  if (!response.ok) throw new Error(`The recorded picture ${imageId} could not be read (${response.status}).`);
  const record = readRecord(await response.json());
  if (record.imageId !== imageId) throw new Error(`The recorded picture ${imageId} holds another picture.`);
  return record;
}
