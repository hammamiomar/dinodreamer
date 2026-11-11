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
 * What the training asked for, in the method names of 3 November 2026: the space the comparison is
 * made in (the basis group's three numbers, or DINO's whole token) and the comparison (the mean, or
 * the distribution). Basis-group mean matching also exists with a guide on DINO units. The last two
 * are research variants: a mixture of mean and distribution matching, and an objective on one DINO unit.
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
 * The place of an automaton whose record names none: a rule grown in the browser, or an entry from
 * before the field. Its file's start gives the start, and its loss gives the method: the browser
 * trains by basis-group mean matching, and the research conversions of that time did too, with or
 * without the guide.
 */
export function placeFromFile(start: "noise" | "centre-disc" | "seeded-field", loss: "plain" | "guided"): GalleryPlace {
  const startOf = { noise: "noise", "centre-disc": "circle", "seeded-field": "circle-on-noise" } as const;
  return {
    start: startOf[start],
    method: loss === "guided" ? "basis-group-mean-guided" : "basis-group-mean",
  };
}
