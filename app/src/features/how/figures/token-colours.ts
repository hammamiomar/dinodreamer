// What the model sees, as colours: the 256 patch tokens of a picture coloured by their three main
// directions. The directions are the principal components of the patch tokens (the picture's own,
// not the library's), found on the 256 × 256 Gram matrix by power iteration with deflation; each
// component's scores are stretched between their 2nd and 98th percentiles to one colour channel.
// The classic DINO figure: patches that the model describes alike get alike colours.
import { PREFIX, WIDTH } from "../how-shapes";

const PATCHES = 256;
const ITERATIONS = 120;

/** The three principal scores of each patch, [256 × 3], from the final tokens [261 × 768]. */
export function principalScores(final_TD: Float32Array): Float32Array {
  const mean_D = new Float32Array(WIDTH);
  for (let patch = 0; patch < PATCHES; patch++) {
    const at = (PREFIX + patch) * WIDTH;
    for (let channel = 0; channel < WIDTH; channel++) mean_D[channel]! += final_TD[at + channel]! / PATCHES;
  }
  // The centred patch tokens, and their Gram matrix G = X Xᵀ: the same spectrum as the covariance.
  const centred_ND = new Float32Array(PATCHES * WIDTH);
  for (let patch = 0; patch < PATCHES; patch++) {
    const at = (PREFIX + patch) * WIDTH;
    for (let channel = 0; channel < WIDTH; channel++) centred_ND[patch * WIDTH + channel] = final_TD[at + channel]! - mean_D[channel]!;
  }
  const gram_NN = new Float64Array(PATCHES * PATCHES);
  for (let a = 0; a < PATCHES; a++) {
    for (let b = a; b < PATCHES; b++) {
      let sum = 0;
      for (let channel = 0; channel < WIDTH; channel++) sum += centred_ND[a * WIDTH + channel]! * centred_ND[b * WIDTH + channel]!;
      gram_NN[a * PATCHES + b] = sum;
      gram_NN[b * PATCHES + a] = sum;
    }
  }
  // An eigenvector u of G with eigenvalue λ gives the scores √λ · u of one principal direction.
  const scores_NR = new Float32Array(PATCHES * 3);
  for (let component = 0; component < 3; component++) {
    const { vector, value } = topEigenvector(gram_NN);
    const scale = Math.sqrt(Math.max(value, 0));
    for (let patch = 0; patch < PATCHES; patch++) scores_NR[patch * 3 + component] = scale * vector[patch]!;
    // Deflate: G ← G − λ u uᵀ.
    for (let a = 0; a < PATCHES; a++) for (let b = 0; b < PATCHES; b++) gram_NN[a * PATCHES + b]! -= value * vector[a]! * vector[b]!;
  }
  return scores_NR;
}

/** The largest eigenpair of a symmetric matrix by power iteration from a fixed start. */
function topEigenvector(matrix_NN: Float64Array): { vector: Float64Array; value: number } {
  let vector = new Float64Array(PATCHES).fill(1 / Math.sqrt(PATCHES));
  let value = 0;
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const next = new Float64Array(PATCHES);
    for (let a = 0; a < PATCHES; a++) {
      let sum = 0;
      for (let b = 0; b < PATCHES; b++) sum += matrix_NN[a * PATCHES + b]! * vector[b]!;
      next[a] = sum;
    }
    const length = Math.sqrt(next.reduce((total, entry) => total + entry * entry, 0));
    if (length === 0) return { vector, value: 0 };
    for (let a = 0; a < PATCHES; a++) next[a]! /= length;
    value = length;
    vector = next;
  }
  // A fixed sign, so the colours do not flip between runs: the largest-magnitude entry is positive.
  let largest = 0;
  for (let a = 1; a < PATCHES; a++) if (Math.abs(vector[a]!) > Math.abs(vector[largest]!)) largest = a;
  if (vector[largest]! < 0) for (let a = 0; a < PATCHES; a++) vector[a] = -vector[a]!;
  return { vector, value };
}

/** Each patch's colour, [256 × 3] bytes: each component's scores stretched between their 2nd and 98th percentiles. */
export function principalColours(final_TD: Float32Array): Uint8ClampedArray {
  const scores_NR = principalScores(final_TD);
  const colours = new Uint8ClampedArray(PATCHES * 3);
  for (let component = 0; component < 3; component++) {
    const sorted = Array.from({ length: PATCHES }, (_, patch) => scores_NR[patch * 3 + component]!).sort((a, b) => a - b);
    const low = sorted[Math.floor(0.02 * (PATCHES - 1))]!;
    const high = sorted[Math.ceil(0.98 * (PATCHES - 1))]!;
    const span = high - low || 1;
    for (let patch = 0; patch < PATCHES; patch++) {
      colours[patch * 3 + component] = Math.round(255 * Math.min(1, Math.max(0, (scores_NR[patch * 3 + component]! - low) / span)));
    }
  }
  return colours;
}
