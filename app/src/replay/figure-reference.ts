// The figure rule's replay contract on the CPU: the specification that the WGSL
// runtime (figure-shaders.ts) and the research oracle (engine/tools/prepare_figure_replay.py)
// both follow. Tests use it; How's NCA explorable steps one tick with it, by hand (features/how/).
//
// State x has shape [side·side, 16], row-major cells, float32. One tick:
//   fires(cell)  = u24(pcg(pcg(pcg(seed ^ FIRE_KEY) + tick) + cell)) / 2^24 < fireRate
//   p            = per channel c: identity, Sobel x/8, Sobel y/8, nine-point Laplacian/16,
//                  read on a torus; index 4c + k (E1's channel-major order)
//   h            = relu(W1 p + b),  W1 [96,64], b [96]
//   x'           = x + W2 h where the cell fires, x elsewhere;  W2 [16,96]
// The start state is u24(pcg(pcg(seed ^ NOISE_KEY) + i)) / 2^24 − 0.5 for i = 16·cell + c,
// uniform on [−0.5, 0.5) like the trainer's torch.rand − 0.5; a seeded start keeps it only inside a disc
// at the grid centre (cell offsets c − side/2 + 0.5, dx² + dy² ≤ r²) and is zero elsewhere. The brush (figure-shaders.ts,
// damage) is a soft disc keyed by its stamp count: hidden channels move toward fresh start values,
// R, G and B toward one grey value per cell; engine/tools/figure_contract.py damage_grey states it.

export const CHANNELS = 16;
export const HIDDEN = 96;
export const PERCEPTIONS = 64;
/** Offsets into the 7,776 rule values: fc1.weight, fc1.bias, fc2.weight. */
export const BIAS_OFFSET = HIDDEN * PERCEPTIONS;
export const OUTPUT_OFFSET = BIAS_OFFSET + HIDDEN;
/** Four ASCII letters each, so a stream's purpose is readable in a hex dump. */
export const NOISE_KEY = 0x6e6f6973; // "nois"
export const FIRE_KEY = 0x66697265; // "fire"
export const DAMAGE_KEY = 0x64616d67; // "damg"
export const HIDDEN_KEY = 0x6869646e; // "hidn"
/** The pyramid's coarse grid draws its start, firing and brush from its own streams. */
export const COARSE_NOISE_KEY = 0x636e6f69; // "cnoi"
export const COARSE_FIRE_KEY = 0x63666972; // "cfir"
export const COARSE_DAMAGE_KEY = 0x63646d67; // "cdmg"

/** The PCG hash of Jarzynski and Olano (2020), "Hash Functions for GPU Rendering", on u32. */
export function pcg(value: number): number {
  const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** The top 24 bits as a float in [0, 1); exact in float32. */
export function unit(hash: number): number {
  return (hash >>> 8) / 16777216;
}

/**
 * A seeded start (startDisc > 0) is the draw times startBackground outside the cells whose centres lie
 * within startDisc of the grid centre, and zero there when startBackground is 0.
 */
export function startState(side: number, seed: number, startDisc = 0, noiseKey = NOISE_KEY, startBackground = 0): Float32Array {
  const key = pcg((seed ^ noiseKey) >>> 0);
  const state = new Float32Array(side * side * CHANNELS);
  for (let index = 0; index < state.length; index++) {
    const cell = Math.floor(index / CHANNELS);
    const dx = cell % side - side / 2 + 0.5;
    const dy = Math.floor(cell / side) - side / 2 + 0.5;
    const outside = startDisc > 0 && dx * dx + dy * dy > startDisc * startDisc;
    const value = unit(pcg((key + index) >>> 0)) - 0.5;
    state[index] = !outside ? value : startBackground > 0 ? Math.fround(startBackground * value) : 0;
  }
  return state;
}

export function fires(seed: number, tick: number, cell: number, fireRate: number, fireKey = FIRE_KEY): boolean {
  return unit(pcg((pcg((pcg((seed ^ fireKey) >>> 0) + tick) >>> 0) + cell) >>> 0)) < Math.fround(fireRate);
}

/** Where one rule's weights sit in the rule values, and how many inputs it reads. */
interface Weights { w1: number; b1: number; w2: number; inputs: 64 | 80 }
const CELL_WEIGHTS: Weights = { w1: 0, b1: BIAS_OFFSET, w2: OUTPUT_OFFSET, inputs: 64 };
/** The pyramid's fine rule, after the coarse rule's 7,776 values: fc1.weight [96,80], fc1.bias [96], fc2.weight [16,96]. */
const FINE_WEIGHTS: Weights = { w1: 7776, b1: 7776 + 96 * 80, w2: 7776 + 96 * 80 + 96, inputs: 80 };
export const PYRAMID_RULE_VALUES = FINE_WEIGHTS.w2 + CHANNELS * HIDDEN;

/** One tick on a torus. Products and sums round to float32 like the shader's arithmetic. */
export function referenceStep(state: Float32Array, rule: Float32Array, side: number, seed: number, tick: number, fireRate: number): Float32Array {
  return stepGrid(state, rule, CELL_WEIGHTS, side, seed, tick, fireRate, FIRE_KEY);
}

/**
 * One pyramid tick: the coarse grid (side/2 cells) steps with the rule's first 7,776 values and its own
 * fire stream, then the fine grid steps with inputs 64–79 read from the new coarse grid, upsampled on
 * the torus (figure-shaders.ts TORUS).
 */
export function referencePyramidStep(fine: Float32Array, coarse: Float32Array, rule: Float32Array, side: number, seed: number, tick: number, fireRate: number) {
  const nextCoarse = stepGrid(coarse, rule, CELL_WEIGHTS, side / 2, seed, tick, fireRate, COARSE_FIRE_KEY);
  const context = (x: number, y: number, channel: number) => upsampleTorus(nextCoarse, side / 2, x, y, channel);
  return { fine: stepGrid(fine, rule, FINE_WEIGHTS, side, seed, tick, fireRate, FIRE_KEY, context), coarse: nextCoarse };
}

/** Torus upsampling at fine cell (x, y): fine cell j reads coarse position j/2 − 0.25 with wrap; width weights inside height weights. */
export function upsampleTorus(coarse: Float32Array, coarseSide: number, x: number, y: number, channel: number): number {
  const f = Math.fround;
  const axis = (j: number) => {
    const k = Math.floor(j / 2);
    return j % 2 === 0
      ? { i0: (k + coarseSide - 1) % coarseSide, i1: k, l0: 0.25, l1: 0.75 }
      : { i0: k, i1: (k + 1) % coarseSide, l0: 0.75, l1: 0.25 };
  };
  const h = axis(y);
  const w = axis(x);
  const at = (cx: number, cy: number) => coarse[(cy * coarseSide + cx) * CHANNELS + channel];
  const top = f(f(at(w.i0, h.i0) * w.l0) + f(at(w.i1, h.i0) * w.l1));
  const bottom = f(f(at(w.i0, h.i1) * w.l0) + f(at(w.i1, h.i1) * w.l1));
  return f(f(top * h.l0) + f(bottom * h.l1));
}

function stepGrid(
  state: Float32Array, rule: Float32Array, weights: Weights, side: number, seed: number, tick: number, fireRate: number, fireKey: number,
  context?: (x: number, y: number, channel: number) => number,
): Float32Array {
  const f = Math.fround;
  const next = state.slice();
  for (let cell = 0; cell < side * side; cell++) {
    if (!fires(seed, tick, cell, fireRate, fireKey)) continue;
    const { delta } = updateCell(state, rule, weights, side, cell, context);
    for (let channel = 0; channel < CHANNELS; channel++) next[cell * CHANNELS + channel] = f(state[cell * CHANNELS + channel] + delta[channel]);
  }
  return next;
}

/** One cell's update, every step kept: what How's NCA explorable shows of a cell (features/how/nca-math.ts). */
export interface CellUpdate {
  /** 64 values, 4c + k: channel c through identity, Sobel x / 8, Sobel y / 8, Laplacian / 16. */
  perception: Float32Array;
  /** 96 values, W1 p + b, before the ReLU. */
  preActivation: Float32Array;
  /** 16 values, W2 relu(W1 p + b): what the cell adds to its state when it fires. */
  delta: Float32Array;
}

/** One cell of a cell rule (7,776 values) on a torus, as one tick computes it for a cell that fires. */
export function referenceCellUpdate(state: Float32Array, rule: Float32Array, side: number, cell: number): CellUpdate {
  return updateCell(state, rule, CELL_WEIGHTS, side, cell);
}

function updateCell(
  state: Float32Array, rule: Float32Array, weights: Weights, side: number, cell: number,
  context?: (x: number, y: number, channel: number) => number,
): CellUpdate {
  const f = Math.fround;
  const perception = new Float32Array(weights.inputs);
  const x = cell % side;
  const y = Math.floor(cell / side);
  const at = (dx: number, dy: number, channel: number) =>
    state[(((y + dy + side) % side) * side + ((x + dx + side) % side)) * CHANNELS + channel];
  for (let channel = 0; channel < CHANNELS; channel++) {
    const [nw, n, ne] = [at(-1, -1, channel), at(0, -1, channel), at(1, -1, channel)];
    const [w, centre, e] = [at(-1, 0, channel), at(0, 0, channel), at(1, 0, channel)];
    const [sw, s, se] = [at(-1, 1, channel), at(0, 1, channel), at(1, 1, channel)];
    perception[channel * 4] = centre;
    perception[channel * 4 + 1] = f(f(f(ne + f(2 * e)) + se) - f(f(nw + f(2 * w)) + sw)) / 8;
    perception[channel * 4 + 2] = f(f(f(sw + f(2 * s)) + se) - f(f(nw + f(2 * n)) + ne)) / 8;
    const ring = f(f(f(f(f(f(f(nw + f(2 * n)) + ne) + f(2 * w)) + f(2 * e)) + sw) + f(2 * s)) + se);
    perception[channel * 4 + 3] = f(ring - f(12 * centre)) / 16;
  }
  if (context) for (let channel = 0; channel < CHANNELS; channel++) perception[PERCEPTIONS + channel] = context(x, y, channel);
  const preActivation = new Float32Array(HIDDEN);
  const delta = new Float32Array(CHANNELS);
  for (let unitIndex = 0; unitIndex < HIDDEN; unitIndex++) {
    let hidden = rule[weights.b1 + unitIndex];
    for (let input = 0; input < weights.inputs; input++) hidden = f(hidden + f(rule[weights.w1 + unitIndex * weights.inputs + input] * perception[input]));
    preActivation[unitIndex] = hidden;
    if (hidden <= 0) continue;
    for (let channel = 0; channel < CHANNELS; channel++) {
      delta[channel] = f(delta[channel] + f(rule[weights.w2 + channel * HIDDEN + unitIndex] * hidden));
    }
  }
  return { perception, preActivation, delta };
}

/** The displayed byte: clamp(x + 0.5, 0, 1) · 255, rounded half to even like torch.round. */
export function displayByte(value: number): number {
  return roundByte(Math.fround(Math.min(1, Math.max(0, Math.fround(value + 0.5)))));
}

/** round-half-even(255 · v) for a picture value v in [0, 1], in float32, as torch.round. */
export function roundByte(value: number): number {
  const scaled = Math.fround(value * 255);
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower + (lower % 2);
}

/**
 * The picture's RGBA bytes, (side · pixelsPerCell)² pixels, as figure-shaders.ts PICTURE states it: each
 * cell's clamp(x + 0.5, 0, 1); at 2 pixels per cell, torch's bilinear upsampling (align_corners false,
 * edges clamped) in its order of operations, the width weights inside the height weights.
 */
export function pictureBytes(state: Float32Array, side: number, pixelsPerCell: 1 | 2): Uint8ClampedArray<ArrayBuffer> {
  const f = Math.fround;
  const pictureSide = side * pixelsPerCell;
  const colour = (x: number, y: number, channel: number) => f(Math.min(1, Math.max(0, f(state[(y * side + x) * CHANNELS + channel] + 0.5))));
  const axis = (q: number) => {
    const source = Math.max(f(f(f(q + 0.5) / pixelsPerCell) - 0.5), 0);
    const i0 = Math.floor(source);
    const l1 = f(source - i0);
    return { i0, i1: Math.min(i0 + 1, side - 1), l0: f(1 - l1), l1 };
  };
  const bytes = new Uint8ClampedArray(pictureSide * pictureSide * 4);
  for (let y = 0; y < pictureSide; y++) {
    for (let x = 0; x < pictureSide; x++) {
      const h = axis(y);
      const w = axis(x);
      for (let channel = 0; channel < 3; channel++) {
        const top = f(f(colour(w.i0, h.i0, channel) * w.l0) + f(colour(w.i1, h.i0, channel) * w.l1));
        const bottom = f(f(colour(w.i0, h.i1, channel) * w.l0) + f(colour(w.i1, h.i1, channel) * w.l1));
        const value = pixelsPerCell === 1 ? colour(x, y, channel) : f(f(top * h.l0) + f(bottom * h.l1));
        bytes[(y * pictureSide + x) * 4 + channel] = roundByte(value);
      }
      bytes[(y * pictureSide + x) * 4 + 3] = 255;
    }
  }
  return bytes;
}

/** The pyramid's picture bytes, side² pixels: clamp(upsample_torus(coarse RGB) + fine RGB + 0.5, 0, 1). */
export function pyramidPictureBytes(fine: Float32Array, coarse: Float32Array, side: number): Uint8ClampedArray {
  const f = Math.fround;
  const bytes = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      for (let channel = 0; channel < 3; channel++) {
        const sum = f(f(upsampleTorus(coarse, side / 2, x, y, channel) + fine[(y * side + x) * CHANNELS + channel]) + 0.5);
        bytes[(y * side + x) * 4 + channel] = roundByte(Math.min(1, Math.max(0, sum)));
      }
      bytes[(y * side + x) * 4 + 3] = 255;
    }
  }
  return bytes;
}

/**
 * Reserved playback noise (σ > 0 only): the standard normal draw added, times σ, to channel
 * c ∈ 3…15 of cell n after tick τ's update, by Box–Muller from two hashes. The shader computes
 * the same formula in float32, so the two agree to rounding, not bit for bit.
 */
export function hiddenNoiseDraw(seed: number, tick: number, cell: number, channel: number): number {
  const key = pcg((pcg((seed ^ HIDDEN_KEY) >>> 0) + tick) >>> 0);
  const index = 2 * (cell * CHANNELS + channel);
  const radius = Math.sqrt(-2 * Math.log(1 - unit(pcg((key + index) >>> 0))));
  return radius * Math.cos(2 * Math.PI * unit(pcg((key + index + 1) >>> 0)));
}

/**
 * One brush stamp on the CPU (figure-shaders.ts, damage): a soft disc on the torus moves the hidden
 * channels toward fresh start values and R, G and B toward one grey value per cell.
 */
export function referenceStamp(state: Float32Array, side: number, seed: number, count: number, cx: number, cy: number, radius: number): Float32Array {
  const f = Math.fround;
  const next = state.slice();
  const key = pcg((pcg((seed ^ DAMAGE_KEY) >>> 0) + count) >>> 0);
  for (let cell = 0; cell < side * side; cell++) {
    let dx = Math.abs(f(cell % side) - f(cx));
    let dy = Math.abs(f(Math.floor(cell / side)) - f(cy));
    dx = Math.min(dx, side - dx);
    dy = Math.min(dy, side - dy);
    const t = Math.min(1, Math.max(0, (radius - Math.hypot(dx, dy)) / Math.max(radius / 4, 1)));
    const weight = t * t * (3 - 2 * t);
    if (weight <= 0) continue;
    for (let channel = 0; channel < CHANNELS; channel++) {
      const index = cell * CHANNELS + channel;
      const goal = channel < 3 ? 0.2 * (unit(pcg((key + cell * CHANNELS) >>> 0)) - 0.5) : unit(pcg((key + index) >>> 0)) - 0.5;
      next[index] = f(state[index] + weight * (goal - state[index]));
    }
  }
  return next;
}
