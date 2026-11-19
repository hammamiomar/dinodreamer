// Basis-space projection for the How explanation diagrams.
// D = 768 token coordinates, R = 3 basis directions.
import { RANK, WIDTH } from "./how-shapes";

export function projectBasis(calibrated_D: Float32Array, frame_RD: Float32Array): [number, number, number] {
  const response: [number, number, number] = [0, 0, 0];
  for (let direction = 0; direction < RANK; direction++) {
    for (let coordinate = 0; coordinate < WIDTH; coordinate++) {
      response[direction]! += calibrated_D[coordinate]! * frame_RD[direction * WIDTH + coordinate]!;
    }
  }
  return response;
}
