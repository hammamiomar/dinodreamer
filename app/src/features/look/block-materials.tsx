// Up to eight published automata for the block, with successful runs first.
// Each tile opens its automaton on the group's screen of the Automata page; this view has no player.

import { Link } from "react-router";
import { RULE_CHOICES, START_WORDS } from "../../grow/material-kind";
import { materialFileUrl, type MaterialIndexState } from "../gallery/material-gallery";
import { materialsOfBlock, type MaterialEntry } from "../gallery/material-index";
import { groupPath } from "../automata/gallery";
import { entryKind } from "../playground/playground";
import { LOOK_TEXT } from "./look-text";

/** One row of the module grid: eight tiles at 1440 (fewer show on a phone, by CSS). */
const TILES = 8;

/** While the index is read, the section keeps its heading and its place. */
export function BlockMaterials({ block, index }: { block: number; index: MaterialIndexState }) {
  const entries = index.status === "ready" ? materialsOfBlock(index.index, block) : [];
  return (
    <section className="look-materials" aria-labelledby="look-materials-title">
      <div className="look-group-head">
        <h2 id="look-materials-title" className="label">{LOOK_TEXT.materials.title}</h2>
        {index.status === "ready" && <span className="look-count">{entries.length}</span>}
        {entries.length > 0 && <Link className="link-control look-all" to={groupPath(block)}>{LOOK_TEXT.materials.all(entries.length)}</Link>}
      </div>
      {index.status === "failed" && <p className="muted">{LOOK_TEXT.materials.failed(index.message)}</p>}
      {index.status === "ready" && entries.length === 0 && <p className="muted">{LOOK_TEXT.materials.none}</p>}
      {entries.length > 0 && (
        <ul className="look-material-tiles">
          {entries.slice(0, TILES).map((entry) => <MaterialTile key={entry.id} entry={entry} />)}
        </ul>
      )}
    </section>
  );
}

/**
 * The reading under a tile: the strength the material reached (times the block's median winning
 * norm) when it fired, else that it did not fire. The index records only the band asked for,
 * Strongest for nearly all, so the strength is what tells two materials apart.
 */
export function materialReading(entry: MaterialEntry): string {
  if (!entry.fired) return LOOK_TEXT.materials.didNotFire;
  return entry.strength === null ? "" : entry.strength.toFixed(2);
}

/** Three lines under the poster: the rule, the start, the reading. */
function MaterialTile({ entry }: { entry: MaterialEntry }) {
  const kind = entryKind(entry);
  const rule = RULE_CHOICES.find((choice) => choice.value === kind.rule)!.label;
  const start = START_WORDS[kind.start];
  return (
    <li>
      <Link className="look-material" to={groupPath(entry.block, entry.id)} data-fired={entry.fired || undefined}>
        <img src={materialFileUrl(entry.id, "poster.png", entry.tick)} width={entry.side} height={entry.side} alt="" loading="lazy" />
        <span className="look-material-name">
          <span>{entry.pixelsPerCell === 2 ? LOOK_TEXT.materials.twoPixels(rule) : rule}</span>
          <span>{start}</span>
          <span className="look-material-reading">{materialReading(entry)}</span>
        </span>
      </Link>
    </li>
  );
}
