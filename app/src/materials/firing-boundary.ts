import { FIRES } from "./material-file";

// Audit helper that computes the firing boundary against shipped main-direction material runs.

/**
 * Projection on the main direction at tick 600, in units of m. Across the 44 shipped baseline
 * main-direction runs, the lowest projection that met the selection target is 1.2225 m and the
 * highest that missed is 1.5455 m. Bounds round outward.
 */
export const FIRING_BOUNDARY_M = [1.22, 1.55] as const;

/**
 * Interval spanning from the lowest strength of a run that met the selection target to the
 * highest strength of a run that missed. Below it no run fired, above it every run fired.
 */
export function firingBoundary(runs: readonly { strength: number; winnerFraction: number }[]): [number, number] {
  const met = runs.filter((run) => run.winnerFraction >= FIRES).map((run) => run.strength);
  const missed = runs.filter((run) => run.winnerFraction < FIRES).map((run) => run.strength);
  return [Math.min(...met), Math.max(...missed)];
}
