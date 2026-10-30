// The BSF explorable's arithmetic. A token x (768,
// calibrated) has a code on each block g, c_g = F_gᵀ x, three numbers; the gate keeps the 32 blocks
// with the largest ‖c_g‖; the token is rebuilt as x̂ = γ · Σ_k F_k c_k with the model's one gain γ.
// F_g is stored here as its transpose, [3, 768]: three directions of 768 numbers.

import { RANK, WIDTH } from "./how-shapes";

/** The share of the token's energy a rebuild explains, from its relative remainder r = ‖x − x̂‖ / ‖x‖: 1 − r². */
export function explainedEnergy(remainder: number): number {
  return Math.max(0, 1 - remainder * remainder);
}

/**
 * The residual ‖x − x̂_k‖ / ‖x‖ after the first k winners, k = 0 to 32: x̂_k = γ · Σ_{j ≤ k} F_j c_j.
 * The last value is the gate's own residual.
 */
export function residualCurve(calibrated: Float32Array, codes_KR: Float32Array, frames_KRD: readonly Float32Array[], gain: number): number[] {
  const rebuilt = new Float32Array(WIDTH);
  const size = Math.hypot(...calibrated);
  const residual = () => {
    let missed = 0;
    for (let channel = 0; channel < WIDTH; channel++) missed += (calibrated[channel]! - rebuilt[channel]!) ** 2;
    return Math.sqrt(missed) / size;
  };
  const curve = [residual()];
  frames_KRD.forEach((frame_RD, winner) => {
    for (let direction = 0; direction < RANK; direction++) {
      const weight = gain * codes_KR[winner * RANK + direction]!;
      for (let channel = 0; channel < WIDTH; channel++) rebuilt[channel]! += weight * frame_RD[direction * WIDTH + channel]!;
    }
    curve.push(residual());
  });
  return curve;
}

/** The block's contribution to the rebuilt token: γ · F c, 768 numbers. */
export function contribution(frame_RD: Float32Array, code: readonly number[], gain: number): Float32Array {
  const part = new Float32Array(WIDTH);
  for (let index = 0; index < RANK; index++) {
    for (let channel = 0; channel < WIDTH; channel++) part[channel]! += gain * code[index]! * frame_RD[index * WIDTH + channel]!;
  }
  return part;
}

/** Which winner a block is, or −1. */
export function winnerIndex(blocks: Uint16Array, block: number): number {
  return blocks.indexOf(block);
}
