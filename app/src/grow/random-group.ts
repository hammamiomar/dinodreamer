// Train's door to a basis group at random. Every group of the collection is a candidate, and none is
// preferred for how well it trains: the visitor is not steered. All 16,384 groups have Level 4
// patches in the Index's sample (measured on the released index, 25 November 2026), so a draw needs
// no index read; the rare group whose Level 4 patches have no public picture says so on Train, which
// offers another draw there.

/** The basis collection's size: groups are numbered 0 to 16,383. */
const BASIS_GROUPS = 16384;

/** A basis group chosen evenly by `random` in [0, 1), never `current`, so each draw shows another group. */
export function randomGroup(random: number, current: number | null = null): number {
  if (current === null) return Math.min(BASIS_GROUPS - 1, Math.floor(random * BASIS_GROUPS));
  // Draw one of the other groups as 0 … BASIS_GROUPS − 2, then step over the current one.
  const drawn = Math.min(BASIS_GROUPS - 2, Math.floor(random * (BASIS_GROUPS - 1)));
  return drawn >= current ? drawn + 1 : drawn;
}
