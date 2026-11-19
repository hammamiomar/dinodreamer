// An automaton's place in its basis group's grid on the Automata page (features/automata/): the state
// it starts from, and what its training asked for. Luck decides the rest, so several automata can
// share a place. The research export sets the place of a research run (`gallery` on a row of the run
// index, research-runs.ts); a published entry carries it (material-index.ts), and an entry without
// one takes its place from its file's start and loss. No browser or React imports: the gallery Worker
// reads the same values.

/**
 * Where an automaton starts: noise in every cell; a circle of noise at the center on zero; that circle
 * on faint noise; a circle that training placed anywhere (it plays from the center); or a start a
 * person drew.
 */
export const GALLERY_STARTS = ["noise", "circle", "circle-on-noise", "circle-anywhere", "drawn"] as const;
export type GalleryStart = (typeof GALLERY_STARTS)[number];

/**
 * Training objective categories: comparison space (the basis group's three coordinates or the full
 * DINO token) and comparison type (mean or distribution), plus guided mean and research variants.
 */
export const GALLERY_METHODS = [
  "basis-group-mean",
  "basis-group-mean-guided",
  "basis-group-distribution",
  "token-mean",
  "token-distribution",
  "mean-distribution-mix",
  "unit-activation",
] as const;
export type GalleryMethod = (typeof GALLERY_METHODS)[number];

export interface GalleryPlace {
  start: GalleryStart;
  method: GalleryMethod;
}

export function isGalleryStart(value: unknown): value is GalleryStart {
  return (GALLERY_STARTS as readonly unknown[]).includes(value);
}

export function isGalleryMethod(value: unknown): value is GalleryMethod {
  return (GALLERY_METHODS as readonly unknown[]).includes(value);
}

/** Whether two automata share a cell of their group's grid. */
export function samePlace(a: GalleryPlace, b: GalleryPlace): boolean {
  return a.start === b.start && a.method === b.method;
}

/**
 * The place of an automaton grown in the browser, or of an entry from before the field. Its file's
 * start gives the start. The method its file records (`settings.method`) gives the method; a file
 * without one was trained by basis-group mean matching, as the research conversions of that time
 * were, with or without the guide, which its loss says.
 */
export function placeFromFile(start: "noise" | "centre-disc" | "seeded-field", loss: "plain" | "guided", method?: GalleryMethod): GalleryPlace {
  const startOf = { noise: "noise", "centre-disc": "circle", "seeded-field": "circle-on-noise" } as const;
  return {
    start: startOf[start],
    method: method ?? (loss === "guided" ? "basis-group-mean-guided" : "basis-group-mean"),
  };
}
