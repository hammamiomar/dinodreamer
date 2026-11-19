// Saved figure materials share the Automata stage with published ones. Their source reads the
// definition and poster from memory instead of the gallery Worker.

import type { FigureMaterial } from "../../materials/material-file";
import { fired } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";
import type { MaterialSource } from "../../replay/material-stage";

export interface KeptFigure {
  entry: MaterialEntry;
  material: FigureMaterial;
}

/** Build a `MaterialEntry` from a locally saved figure material, keeping its original id. */
export function keptEntry(material: FigureMaterial): MaterialEntry {
  const { file } = material;
  const { experiment, measurementDirection } = file.recipe.settings;
  return {
    id: file.id,
    title: file.name,
    credit: "",
    publishedAt: "",
    materialId: file.id,
    block: file.block,
    recipe: file.recipe.name,
    band: file.anchor.band,
    strength: file.reading.strength,
    winnerFraction: file.reading.winnerFraction,
    fired: fired(file.reading),
    ...(file.reading.region ? { region: file.reading.region } : {}),
    side: file.reading.side,
    seed: file.reading.seed,
    tick: file.reading.tick,
    engine: file.engine,
    trainerCommit: file.trainerCommit,
    layout: file.rule.layout,
    start: file.start?.kind ?? "noise",
    pixelsPerCell: file.picture?.pixelsPerCell ?? 1,
    ...(typeof experiment === "string" ? { experiment } : {}),
    ...(typeof measurementDirection === "string" ? { measurementDirection } : {}),
  };
}

/** Wrap a published `MaterialSource` so locally saved entries resolve from memory. */
export function withKept(figures: readonly KeptFigure[], published: MaterialSource): MaterialSource {
  const byId = new Map(figures.map((figure) => [figure.entry.id, figure.material]));
  return {
    load: (entry) => {
      const kept = byId.get(entry.id);
      return kept ? Promise.resolve(kept) : published.load(entry);
    },
    poster: (entry) => byId.get(entry.id)?.file.preview ?? published.poster(entry),
    keepable: (entry) => !byId.has(entry.id) && published.keepable(entry),
  };
}
