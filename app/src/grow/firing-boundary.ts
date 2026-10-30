import { FIRES } from "../materials/material-file";

// The materials audit checks this recorded boundary against the shipped E18 and E19 materials.

/**
 * Projection on the main direction at tick 600, in units of m. Among the 44 E18 and E19 runs in
 * gallery/seed/materials, the lowest projection that meets the selection target is 1.2225 m
 * (13364, seed 1); the highest that misses is 1.5455 m (12299, seed 1). Bounds round outward.
 */
export const FIRING_BOUNDARY_M = [1.22, 1.55] as const;

/**
 * The boundary of a set of runs: from the lowest projection of a run that met the selection target
 * to the highest of a run that did not. Below it no run met the target, above it every run did, and
 * both outcomes occur inside it.
 */
export function firingBoundary(runs: readonly { strength: number; winnerFraction: number }[]): [number, number] {
  const met = runs.filter((run) => run.winnerFraction >= FIRES).map((run) => run.strength);
  const missed = runs.filter((run) => run.winnerFraction < FIRES).map((run) => run.strength);
  return [Math.min(...met), Math.max(...missed)];
}
