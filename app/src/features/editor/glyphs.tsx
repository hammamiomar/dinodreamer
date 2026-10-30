// Editor glyphs use a 16-unit grid, 1.5-unit strokes and square ends.
// Callers provide accessible names and tooltips; styles enlarge glyphs for touch.


const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "square", strokeLinejoin: "miter" } as const;

export function BrushGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path {...STROKE} d="M13.5 2.5 L8.5 7.5" />
      <path {...STROKE} d="M8 6 L10 8" />
      <path fill="currentColor" d="M7.6 7.4 C5.4 7.6 4.6 9.2 4.6 10.8 C4.6 12.4 3.6 13.2 2 13.6 C5.4 14.6 9.2 13.2 9.4 9.4 Z" />
    </svg>
  );
}

export function EraserGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path {...STROKE} d="M2.5 9.5 L8.5 3.5 L13 8 L7 14 L4.5 14 Z" />
      <path {...STROKE} d="M5.5 6.5 L10 11" />
      <path {...STROKE} d="M9 14 L14 14" />
    </svg>
  );
}

/** Closed: one stroke paints both areas. Open: the shackle is lifted and turned out. */
export function LockGlyph({ locked, size = 16 }: { locked: boolean; size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path {...STROKE} d={locked ? "M5 7 V5 A3 3 0 0 1 11 5 V7" : "M5 7 V4 A3 3 0 0 1 11 4 V4.5"} />
      <rect x="3" y="7.5" width="10" height="7" fill={locked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The brush's opacity, "how strong": the same disc as an outline, its lower half filled. */
export function OpacityGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle {...STROKE} cx="8" cy="8" r="5" />
      <path fill="currentColor" d="M3 8 A5 5 0 0 0 13 8 Z" />
    </svg>
  );
}

/** A stepper's minus: one stroke across. */
export function MinusGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path {...STROKE} d="M3.5 8 H12.5" />
    </svg>
  );
}

/** A stepper's plus: the minus and one stroke down. */
export function PlusGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path {...STROKE} d="M3.5 8 H12.5 M8 3.5 V12.5" />
    </svg>
  );
}

/** Save image: a picture, a frame with a hill and a sun. */
export function ImageGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect {...STROKE} x="2.75" y="2.75" width="10.5" height="10.5" />
      <path {...STROKE} d="M4.5 11.5 L7.25 8.75 L9 10.5 L10.25 9.25 L11.5 10.5" />
      <rect fill="currentColor" x="9.5" y="5" width="2" height="2" />
    </svg>
  );
}

/** Save video: a moving picture, the same frame with the play triangle in it. */
export function VideoGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect {...STROKE} x="2.75" y="2.75" width="10.5" height="10.5" />
      <path fill="currentColor" d="M6.5 5.5 L10.75 8 L6.5 10.5 Z" />
    </svg>
  );
}
