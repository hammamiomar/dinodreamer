// The automaton's metadata as a small table of labels and values, in the site's words: read in the
// stage's Options panel and shown by the publish form. Never the file's own name, which carries the
// research runs' vocabulary.

import { fill, SITE_WORDS } from "../app/site-words";
import { materialEntry, placeOf, type MaterialEntry } from "../features/gallery/material-index";
import { BAND_NAMES, STRENGTH_BANDS } from "../features/look/strength-bands";
import { tileName } from "../features/automata/kind-line";
import { strengthStatistic, type FigureMaterialFile } from "../materials/material-file";
import "./material-metadata.css";

const WORDS = SITE_WORDS.stage.metadata;

/** The stored value's name, by what the rule's settings say it holds (strengthStatistic). */
const STRENGTH_LABELS = {
  "projection-on-target": WORDS.projection,
  "projection-on-main-direction": WORDS.projectionMain,
  "median-magnitude": WORDS.median,
  unknown: WORDS.recorded,
} as const;

export interface MetadataRow {
  label: string;
  value: string;
}

/**
 * The rows: a title of the person's own, the grids, where it starts and what its training asked for
 * (its place on the Automata page, in that page's words), the reference patch's level, the stored
 * value in m, the selection fraction, whether the selection target was met, and the update count.
 */
export function metadataRows(entry: MaterialEntry, updates: number, title = ""): MetadataRow[] {
  const kind = tileName(entry);
  const place = placeOf(entry);
  const rows: MetadataRow[] = [];
  if (title !== "") rows.push({ label: WORDS.title, value: title });
  rows.push({ label: SITE_WORDS.playground.rule, value: kind.rule });
  rows.push({ label: SITE_WORDS.playground.start, value: SITE_WORDS.automata.startsInLine[place.start] });
  rows.push({ label: WORDS.method, value: SITE_WORDS.automata.methods[place.method] });
  rows.push({ label: WORDS.reference, value: BAND_NAMES[STRENGTH_BANDS.indexOf(entry.band)]! });
  if (entry.strength !== null) {
    const label = STRENGTH_LABELS[strengthStatistic(entry.experiment, entry.measurementDirection)];
    rows.push({ label, value: fill(SITE_WORDS.playground.strengthInM, { strength: entry.strength.toFixed(2) }) });
  }
  if (entry.winnerFraction !== null) {
    rows.push({ label: entry.region === "centre-4x4" ? WORDS.centreSelection : WORDS.selection, value: `${Math.round(entry.winnerFraction * 100)}%` });
  }
  rows.push({ label: WORDS.target, value: entry.fired ? WORDS.met : WORDS.notMet });
  rows.push({ label: WORDS.updates, value: updates.toLocaleString("en-US") });
  return rows;
}

/** The rows of a kept file, before it has an entry; a file's own id may be longer than an entry's. */
export function fileMetadataRows(file: FigureMaterialFile): MetadataRow[] {
  return metadataRows(materialEntry("kept", file, { title: "", credit: "" }, ""), file.training.updates);
}

export function MaterialMetadata({ rows }: { rows: readonly MetadataRow[] }) {
  return (
    <dl className="material-metadata">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
