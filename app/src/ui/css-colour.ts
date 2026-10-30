// Canvas drawing uses the colour tokens of styles.css, so the canvas and the
// interface cannot drift apart. A token's computed value is a CSS colour string
// (oklch() for the base tokens), which a canvas accepts as fillStyle or strokeStyle.

/** The computed value of a colour token such as "--measure", or `fallback` if it is not set. */
export function cssColour(name: `--${string}`, fallback: string, element: Element = document.documentElement): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}
