import { useState, type KeyboardEvent } from "react";
import type { TokenResponses } from "../../library/records";
import { GRID } from "../../recipe";
import { ResponseOverlay, usePictureShown } from "../../ui/responses";
import "./patch-map.css";

/** The arrow keys' moves on the 16 × 16 patch grid. */
const MOVES: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** A patch cell's place over the picture, as percentages of its side. */
function cellPlace(cell: number) {
  return { left: `${(cell % GRID) / GRID * 100}%`, top: `${Math.floor(cell / GRID) / GRID * 100}%` };
}

/**
 * A picture as a map of its 16 × 16 patches. A mouse outlines the patch under it; a click, or a tap on a
 * phone, chooses it. With the keyboard, the arrow keys move the outline, Enter or Space chooses and Escape
 * clears. `lit` tints patches as every response view does (ui/responses.tsx); the chosen patch has a box.
 */
export function PatchMap({ src, name, lit, scale = 1, chosen, choosable = () => true, onPoint, onChoose, onClear }: {
  src: string;
  /** The map's name for a screen reader: what it shows and how to choose a patch. */
  name: string;
  lit: TokenResponses | null;
  /** The strongest lit norm (ui/responses.tsx firingScale); 1 for patches lit alike. */
  scale?: number;
  chosen: number | null;
  /** Patches that can be chosen; the others ignore the pointer. */
  choosable?: (cell: number) => boolean;
  /** The patch under the pointer or the keyboard outline, or null when it leaves. */
  onPoint?: (cell: number | null) => void;
  onChoose: (cell: number) => void;
  /** Escape clears the choice; without it, Escape is left to the page (a panel closes). */
  onClear?: () => void;
}) {
  const picture = usePictureShown(src);
  const [pointed, setPointed] = useState<number | null>(null);
  const point = (cell: number | null) => {
    const next = cell !== null && choosable(cell) ? cell : null;
    if (next === pointed) return;
    setPointed(next);
    onPoint?.(next);
  };
  const cellAt = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const box = event.currentTarget.getBoundingClientRect();
    const column = Math.min(GRID - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * GRID)));
    const row = Math.min(GRID - 1, Math.max(0, Math.floor((event.clientY - box.top) / box.height * GRID)));
    return row * GRID + column;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const move = MOVES[event.key];
    const from = pointed ?? chosen ?? (GRID / 2) * GRID + GRID / 2;
    if (move) {
      event.preventDefault();
      const column = Math.min(GRID - 1, Math.max(0, (from % GRID) + move[0]));
      const row = Math.min(GRID - 1, Math.max(0, Math.floor(from / GRID) + move[1]));
      const cell = row * GRID + column;
      setPointed(cell);
      onPoint?.(choosable(cell) ? cell : null);
    } else if ((event.key === "Enter" || event.key === " ") && choosable(from)) {
      event.preventDefault();
      onChoose(from);
    } else if (event.key === "Escape" && onClear && chosen !== null) {
      event.preventDefault();
      event.stopPropagation();
      onClear();
    }
  };
  return (
    <div className="patch-map">
      <img ref={picture.ref} src={src} onLoad={picture.onLoad} width={256} height={256} alt="" draggable={false} />
      {lit && picture.shown && <ResponseOverlay patches={lit} scale={scale} />}
      {chosen !== null && <span className="patch-map-chosen" style={cellPlace(chosen)} />}
      {pointed !== null && pointed !== chosen && <span className="patch-map-pointed" style={cellPlace(pointed)} />}
      {/* One button over the whole picture takes the pointer and the keys; the patch comes from where it is pressed. */}
      <button type="button" className="patch-map-surface" aria-label={name}
        onPointerMove={(event) => { if (event.pointerType === "mouse") point(cellAt(event)); }}
        onPointerLeave={() => point(null)}
        onBlur={() => point(null)}
        onClick={(event) => {
          // A click from the keyboard (detail 0) has no position; Enter and Space are handled in onKeyDown.
          if (event.detail === 0) return;
          const cell = cellAt(event);
          if (choosable(cell)) onChoose(cell);
        }}
        onKeyDown={onKeyDown} />
    </div>
  );
}
