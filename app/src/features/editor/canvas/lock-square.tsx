// The lock between a request's Code and Appearance fields (state.ts, the lock rule): a
// square with the lock glyph, closed while one stroke paints both fields. On the card it is
// the hinge of the two sections' edges; in the dock it ends the line that names what the
// brush paints. Its words are only its name and tooltip.

import { LockGlyph } from "../glyphs";
import { CREATE_TEXT } from "../create-text";
import "./canvas.css";

export function LockSquare({ linked, onChange }: { linked: boolean; onChange(linked: boolean): void }) {
  const words = linked ? CREATE_TEXT.lock.linked : CREATE_TEXT.lock.unlinked;
  return (
    <button
      type="button"
      className="lock-square"
      aria-pressed={linked}
      aria-label={words}
      title={words}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!linked);
      }}
    >
      <LockGlyph locked={linked} />
    </button>
  );
}
