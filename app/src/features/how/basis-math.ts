// Basis-space calculations. D = 768 token coordinates, R = 3 basis directions, K = selected groups.
import { contribution } from "./bsf-math";
import { RANK, WIDTH } from "./how-shapes";

/** Keep the picture's preferred group when it is selected; otherwise follow its strongest group. */
export function firstBasisGroup(groups: Uint16Array, preferred: number | null): number {
  if (preferred !== null && groups.includes(preferred)) return preferred;
  return groups[0]!;
}

export function projectBasis(calibrated_D: Float32Array, frame_RD: Float32Array): [number, number, number] {
  const response: [number, number, number] = [0, 0, 0];
  for (let direction = 0; direction < RANK; direction++) {
    for (let coordinate = 0; coordinate < WIDTH; coordinate++) {
      response[direction]! += calibrated_D[coordinate]! * frame_RD[direction * WIDTH + coordinate]!;
    }
  }
  return response;
}

/** Partial reconstruction in the existing ranked order. The count never changes the selection. */
export function reconstructBasis(codes_KR: Float32Array, frames_KRD: readonly Float32Array[], gain: number, count: number): Float32Array {
  const reconstructed_D = new Float32Array(WIDTH);
  for (let group = 0; group < Math.min(count, frames_KRD.length); group++) {
    const contribution_D = contribution(frames_KRD[group]!, Array.from(codes_KR.subarray(group * RANK, (group + 1) * RANK)), gain);
    for (let coordinate = 0; coordinate < WIDTH; coordinate++) reconstructed_D[coordinate]! += contribution_D[coordinate]!;
  }
  return reconstructed_D;
}

/** The display rotates three measured coordinates without changing their magnitude. */
export function turnBasisPoint(response: readonly number[], yaw: number, pitch: number): [number, number, number] {
  const x = response[0]! * Math.cos(yaw) + response[2]! * Math.sin(yaw);
  const z = -response[0]! * Math.sin(yaw) + response[2]! * Math.cos(yaw);
  return [x, response[1]! * Math.cos(pitch) - z * Math.sin(pitch), response[1]! * Math.sin(pitch) + z * Math.cos(pitch)];
}

export function relativeBasisResidual(calibrated_D: Float32Array, reconstruction_D: Float32Array): number {
  let residualSquared = 0;
  let tokenSquared = 0;
  for (let coordinate = 0; coordinate < WIDTH; coordinate++) {
    residualSquared += (calibrated_D[coordinate]! - reconstruction_D[coordinate]!) ** 2;
    tokenSquared += calibrated_D[coordinate]! ** 2;
  }
  return tokenSquared > 0 ? Math.sqrt(residualSquared / tokenSquared) : 0;
}
