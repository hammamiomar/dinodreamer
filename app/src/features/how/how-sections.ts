// How it works as one screen (how-page.tsx): the sections in reading order, as data. Each section
// names its act, its figure, and the state of the model map (how-map.tsx): which stages of the
// model exist at that point of the story and which are lit. The words of every section are in
// app/site-words.ts under `how.sections`, keyed by the section's id. This list is the page's
// outline, and the paper's.

/** The acts of the story, the card's tabs. */
export type HowAct = "overview" | "model" | "basis" | "automaton" | "results" | "glossary";
export const HOW_ACTS: readonly HowAct[] = ["overview", "model", "basis", "automaton", "results", "glossary"];

/**
 * The stages of the model map, in the order the map draws them left to right. Act 1 has the
 * picture through the tokens; act 2 appends the basis collection and its responses; act 3
 * prepends the automaton and appends the loss, with the return path from the loss to the rule.
 */
export type HowStage = "automaton" | "picture" | "patches" | "dino" | "tokens" | "basis" | "responses" | "loss";
export const HOW_STAGES: readonly HowStage[] = ["automaton", "picture", "patches", "dino", "tokens", "basis", "responses", "loss"];

const MODEL: readonly HowStage[] = ["picture", "patches", "dino", "tokens"];
const WITH_BASIS: readonly HowStage[] = [...MODEL, "basis", "responses"];
const LOOP: readonly HowStage[] = ["automaton", ...WITH_BASIS, "loss"];

export interface HowMapState {
  /** The stages drawn. */
  present: readonly HowStage[];
  /** The stages lit, the ones this section is about. */
  lit: readonly HowStage[];
  /** The forward path lights stage by stage and the return path runs (the signal section, the overview). */
  signal?: boolean;
}

/** The figures, one component each (figures/); an act's figure stays mounted across its sections. */
export type HowFigure =
  | "loop"
  | "patches" | "attention"
  | "basis-place" | "selection" | "cloud" | "rebuild" | "basis-training"
  | "visualization"
  | "cells" | "scales" | "signal" | "updates" | "local-global"
  | "kinds"
  | "references";

export interface HowSection {
  /** The hash of the section's address, `/how#attention`, and its word key. */
  id: string;
  act: HowAct;
  figure: HowFigure;
  map: HowMapState;
}

export const HOW_SECTIONS: readonly HowSection[] = [
  { id: "overview", act: "overview", figure: "loop", map: { present: LOOP, lit: [], signal: true } },

  { id: "patches", act: "model", figure: "patches", map: { present: MODEL, lit: ["picture", "patches", "tokens"] } },
  { id: "attention", act: "model", figure: "attention", map: { present: MODEL, lit: ["dino"] } },

  { id: "basis-place", act: "basis", figure: "basis-place", map: { present: WITH_BASIS, lit: ["basis"] } },
  { id: "selection", act: "basis", figure: "selection", map: { present: WITH_BASIS, lit: ["basis", "responses"] } },
  { id: "cloud", act: "basis", figure: "cloud", map: { present: WITH_BASIS, lit: ["responses"] } },
  { id: "rebuild", act: "basis", figure: "rebuild", map: { present: WITH_BASIS, lit: ["tokens", "basis", "responses"] } },
  { id: "basis-training", act: "basis", figure: "basis-training", map: { present: WITH_BASIS, lit: ["basis"] } },

  // The bridge: a picture asked to carry a point, before the automaton exists on the map.
  { id: "visualization", act: "automaton", figure: "visualization", map: { present: WITH_BASIS, lit: ["picture", "responses"] } },
  { id: "cells", act: "automaton", figure: "cells", map: { present: LOOP, lit: ["automaton"] } },
  { id: "scales", act: "automaton", figure: "scales", map: { present: LOOP, lit: ["automaton", "picture"] } },
  { id: "signal", act: "automaton", figure: "signal", map: { present: LOOP, lit: ["loss"], signal: true } },
  { id: "updates", act: "automaton", figure: "updates", map: { present: LOOP, lit: ["automaton", "loss"] } },
  { id: "local-global", act: "automaton", figure: "local-global", map: { present: LOOP, lit: ["automaton", "dino"] } },

  { id: "results", act: "results", figure: "kinds", map: { present: LOOP, lit: [] } },

  { id: "glossary", act: "glossary", figure: "references", map: { present: LOOP, lit: [] } },
];

/** The section a stage of the map leads to: the first section of the story that is about it. */
export const STAGE_SECTION: Record<HowStage, string> = {
  picture: "patches",
  patches: "patches",
  dino: "attention",
  tokens: "patches",
  basis: "basis-place",
  responses: "selection",
  automaton: "cells",
  loss: "signal",
};

/**
 * The section that explains each glossary term, by the term as the words name it
 * (app/site-words.ts, how.glossary). In the glossary a term leads there, and while the reader
 * rests on it the map lights that section's stages. A term of the record itself has no section.
 */
export const TERM_SECTIONS: Readonly<Record<string, string>> = {
  patch: "patches",
  token: "patches",
  attention: "attention",
  "basis group": "basis-place",
  basis: "basis-place",
  manifold: "basis-place",
  Grassmannian: "basis-place",
  "block sparse featurizer": "basis-place",
  response: "selection",
  selection: "selection",
  library: "cloud",
  "ring and levels": "cloud",
  "feature visualization": "visualization",
  "cellular automaton": "cells",
  rule: "cells",
  image: "cells",
  "fine grid": "scales",
  "coarse grid": "scales",
  "optimizer update": "updates",
  "selection target": "signal",
  "projection on the target": "signal",
};

/** A section's map with another section's stages lit over it, those the map draws: the glossary lighting the section a term belongs to. */
export function litBy(map: HowMapState, other: HowSection | null): HowMapState {
  if (!other) return map;
  return { ...map, lit: other.map.lit.filter((stage) => map.present.includes(stage)) };
}
