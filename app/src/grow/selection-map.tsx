import { MAP_SIDE, mapCells, type ReadRegion } from "./selection-cells";
import "./selection-map.css";

/** The map is drawn in a 56-unit square: cells of 6 on a pitch of 7, inside a half-unit margin. */
const VIEW = 56;
const PITCH = 7;
const CELL = 6;

/**
 * The grown picture's patches, lit where the requested group is selected (selection-cells.ts). Once
 * the automaton has met the target, the lit cells take its sampled colour, as the frame does.
 */
export function SelectionMap({ selected, region, fired }: { selected: Uint8Array | null; region: ReadRegion; fired: boolean }) {
  return (
    <svg className="selection-map" viewBox={`0 0 ${VIEW} ${VIEW}`} data-lit={fired || undefined} aria-hidden="true">
      {mapCells(selected, region).map((cell, index) => (
        <rect key={index} x={0.5 + (index % MAP_SIDE) * PITCH} y={0.5 + Math.floor(index / MAP_SIDE) * PITCH} width={CELL} height={CELL} data-cell={cell} />
      ))}
    </svg>
  );
}
