/** The Keep replay runtime's damage brush (app/src/replay on materials-stage): the default and range of its radius slider. */
export const BRUSH = { radius: 12, min: 2, max: 32 } as const;

/**
 * The stamps of one pointer movement from (x0, y0) to (x1, y1), in cells: soft discs every quarter
 * radius along the segment, the start excluded, so holding still stamps nothing. The same rule as
 * the replay loop's stroke(); a kept material's replay and the live grid then damage alike.
 */
export function strokeStamps(x0: number, y0: number, x1: number, y1: number, radius: number): [number, number, number][] {
  const spacing = Math.max(radius / 4, 1);
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / spacing);
  return Array.from({ length: steps }, (_, index) => {
    const step = index + 1;
    return [x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps, radius];
  });
}
