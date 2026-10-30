// The shelf lists owner groups, featured automata, saved automata, then published automata by
// basis group. Filters apply only to the published groups. Owner actions update tile marks in place.

import { useId, useRef, useState } from "react";
import { fill, SITE_WORDS } from "../../app/site-words";
import { deleteMaterial, keepMaterial } from "../../storage/materials";
import { readFigureMaterial } from "../../materials/material-file";
import { Segmented } from "../../ui/segmented";
import type { MaterialEntry } from "../gallery/material-index";
import { MaterialLabel } from "../gallery/material-label";
import { PublishMaterial } from "../gallery/publish-material";
import type { MaterialSource } from "../../replay/material-stage";
import { BlockHeading } from "./block-preview";
import { choiceRows, chosenWord, tileReading, type PlaygroundChoices } from "./playground";
import type { KeptFigure } from "./yours";

const WORDS = SITE_WORDS.playground;

/** The kept materials of this device, as the page reads them. */
export interface KeptState {
  status: "loading" | "ready" | "failed";
  message?: string;
  figures: KeptFigure[];
  refresh: () => void;
}

/** Choosing a material: the entry, and the tile's picture, where the outline starts. */
export type Choose = (entry: MaterialEntry, picture: HTMLElement) => void;

/**
 * Owner actions mark the tile below its title and recipe. The owner mode supplies a state and
 * Featured at most; the public Playground shows no marks.
 */
export interface TileMark {
  kind: "hidden" | "featured" | "pending" | "purged" | "approved" | "rejected";
  word: string;
}
/** The marks that take a material out of the public Playground: its tile stays in its place, dim. */
const WITHDRAWN_MARKS: ReadonlySet<TileMark["kind"]> = new Set(["hidden", "purged", "rejected"]);
const NO_MARKS: readonly TileMark[] = [];
const noMarks = () => NO_MARKS;

/** Owner marks stay with the label, in quieter ink. */
function TileMarks({ marks }: { marks: readonly TileMark[] }) {
  if (marks.length === 0) return null;
  return (
    <span className="playground-tile-marks">
      {marks.map((mark) => <span key={mark.kind} data-mark={mark.kind}>{mark.word}</span>)}
    </span>
  );
}

/** One material of the shelf: its title, recipe, picture and measured strength. */
function Tile({ entry, poster, source, pressed, marks, onChoose }: {
  entry: MaterialEntry;
  poster: string;
  source: MaterialSource;
  pressed: boolean;
  marks: readonly TileMark[];
  onChoose: Choose;
}) {
  const withdrawn = marks.some((mark) => WITHDRAWN_MARKS.has(mark.kind));
  return (
    <li>
      <button type="button" className="playground-tile" aria-pressed={pressed} data-fired={entry.fired || undefined}
        data-withdrawn={withdrawn || undefined} data-material={entry.id}
        onClick={(event) => onChoose(entry, event.currentTarget.querySelector("img") ?? event.currentTarget)}>
        <span className="playground-tile-name">
          <MaterialLabel entry={entry} load={source.load} />
          <TileMarks marks={marks} />
        </span>
        <img src={poster} width={entry.side} height={entry.side} alt="" loading="lazy" />
        <span className="playground-tile-reading">{tileReading(entry)}</span>
      </button>
    </li>
  );
}

/** A group with a label line, its title and count, over its tiles: Featured, and the owner mode's groups above it. */
function TileGroup({ title, entries, playing, source, marksOf, onChoose }: {
  title: string;
  entries: readonly MaterialEntry[];
  playing: MaterialEntry | null;
  source: MaterialSource;
  marksOf: (entry: MaterialEntry) => readonly TileMark[];
  onChoose: Choose;
}) {
  const titleId = useId();
  return (
    <section className="playground-group" aria-labelledby={titleId}>
      <div className="playground-line">
        <h2 id={titleId} className="label">{title}</h2>
        <span className="playground-count" aria-label={fill(WORDS.groupCount, { count: entries.length })}>{entries.length}</span>
      </div>
      <ul className="playground-tiles">
        {entries.map((entry) => (
          <Tile key={entry.id} entry={entry} poster={source.poster(entry)} source={source} pressed={entry.id === playing?.id} marks={marksOf(entry)} onChoose={onChoose} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Yours, on this device: what Grow kept, what Keep took from the shelf, and imported files. One
 * line with Import while it is empty. While one of them plays, a line under the tiles offers
 * Publish and Remove for it.
 */
function YoursGroup({ yours, playing, source, marksOf, onChoose, onRemoved }: {
  yours: KeptState;
  playing: MaterialEntry | null;
  source: MaterialSource;
  marksOf: (entry: MaterialEntry) => readonly TileMark[];
  onChoose: Choose;
  onRemoved: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const importFile = async (file: File) => {
    try {
      await keepMaterial(readFigureMaterial(JSON.parse(await file.text())).file);
      setMessage("");
      yours.refresh();
    } catch (error) {
      setMessage(String(error instanceof Error ? error.message : error));
    }
  };
  const count = yours.figures.length;
  const playingKept = playing === null ? undefined : yours.figures.find((figure) => figure.entry.id === playing.id);
  return (
    <section className="playground-yours" aria-labelledby="playground-yours">
      <div className="playground-line">
        <h2 id="playground-yours" className="label">{WORDS.yours}</h2>
        {count === 0 ? <span className="playground-empty">{WORDS.yoursEmpty}</span> : <span className="playground-count">{count}</span>}
        <button type="button" className="playground-word" onClick={() => input.current?.click()}>{WORDS.import}</button>
        <input ref={input} type="file" accept=".json" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = "";
        }} />
      </div>
      {yours.status === "failed" && <p role="alert">{fill(WORDS.yoursFailed, { message: yours.message ?? "" })}</p>}
      {message && <p role="alert">{message}</p>}
      {count > 0 && (
        <ul className="playground-tiles">
          {yours.figures.map(({ entry }) => (
            <Tile key={entry.id} entry={entry} poster={source.poster(entry)} source={source} pressed={entry.id === playing?.id} marks={marksOf(entry)} onChoose={onChoose} />
          ))}
        </ul>
      )}
      {playingKept && (
        <div key={playingKept.entry.id} className="playground-kept-actions" role="group" aria-label={playingKept.entry.title}>
          <PublishMaterial file={playingKept.material.file} />
          <RemoveKept id={playingKept.entry.id} onRemoved={onRemoved} />
        </div>
      )}
    </section>
  );
}

/** Remove asks once more on the spot; a kept material is the visitor's own, so nothing else is touched. */
function RemoveKept({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const remove = () => {
    deleteMaterial(id).then(onRemoved, (error: unknown) => setMessage(String(error instanceof Error ? error.message : error)));
  };
  if (!confirming) return <button type="button" className="playground-word" onClick={() => setConfirming(true)}>{WORDS.remove}</button>;
  return (
    <>
      <button type="button" className="playground-word playground-danger" onClick={remove}>{WORDS.removeConfirm}</button>
      <button type="button" className="playground-word" onClick={() => setConfirming(false)}>{WORDS.removeCancel}</button>
      {message && <span role="alert">{message}</span>}
    </>
  );
}

/** The choices as one line, "Rule any · Start any · Family any" and the count; a word opens its row of options under the line. */
function ChoiceLine({ choices, families, matching, onChange }: {
  choices: PlaygroundChoices;
  families: readonly string[];
  matching: number;
  onChange: (choices: PlaygroundChoices) => void;
}) {
  const [open, setOpen] = useState<keyof PlaygroundChoices | null>(null);
  const rows = choiceRows(families);
  const row = rows.find((candidate) => candidate.key === open);
  return (
    <div className="playground-choices">
      <div className="playground-line">
        {rows.map((candidate) => (
          <button key={candidate.key} type="button" className="playground-choice" aria-expanded={open === candidate.key}
            aria-controls="playground-choice-row" onClick={() => setOpen(open === candidate.key ? null : candidate.key)}>
            <span className="label">{candidate.label}</span> {chosenWord(candidate, choices[candidate.key])}
          </button>
        ))}
        <span className="playground-count" aria-label={fill(WORDS.matching, { count: matching })}>{matching}</span>
      </div>
      {row && (
        <div id="playground-choice-row" className="playground-choice-row">
          <Segmented label={row.label} value={choices[row.key]}
            segments={row.options}
            onChange={(value) => onChange({ ...choices, [row.key]: value })} />
        </div>
      )}
    </div>
  );
}

/**
 * The shelf: the owner mode's leading groups, Featured, Yours, the choices, then every block that the
 * choices keep. Featured and the leading groups do not follow the choices, as Yours does not.
 */
export function PlaygroundShelf({
  yours, playing, source, groups, choices, families, matching, familyOf, onChoices, onChoose, onRemoved,
  featured = [], leadingGroups = [], marksOf = noMarks,
}: {
  yours: KeptState;
  playing: MaterialEntry | null;
  source: MaterialSource;
  groups: readonly { block: number; materials: MaterialEntry[] }[];
  choices: PlaygroundChoices;
  /** The families present, in Explore's order. */
  families: readonly string[];
  matching: number;
  familyOf: (block: number) => string | undefined;
  onChoices: (choices: PlaygroundChoices) => void;
  onChoose: Choose;
  onRemoved: () => void;
  /** The Featured group's materials (featuredMaterials in playground.ts); no group when empty. */
  featured?: readonly MaterialEntry[];
  /** The owner mode's groups above Featured, such as Pending review, each a label line over tiles. */
  leadingGroups?: readonly { key: string; title: string; entries: readonly MaterialEntry[] }[];
  /** The owner mode's marks on each tile, in every group. */
  marksOf?: (entry: MaterialEntry) => readonly TileMark[];
}) {
  return (
    <aside className="playground-shelf" aria-label={SITE_WORDS.header.playground}>
      {leadingGroups.map((group) => (
        <TileGroup key={group.key} title={group.title} entries={group.entries} playing={playing} source={source} marksOf={marksOf} onChoose={onChoose} />
      ))}
      {featured.length > 0 && (
        <TileGroup title={WORDS.featured} entries={featured} playing={playing} source={source} marksOf={marksOf} onChoose={onChoose} />
      )}
      <YoursGroup yours={yours} playing={playing} source={source} marksOf={marksOf} onChoose={onChoose} onRemoved={onRemoved} />
      <ChoiceLine choices={choices} families={families} matching={matching} onChange={onChoices} />
      {matching === 0 && <p className="muted">{WORDS.noMatch}</p>}
      {groups.map(({ block, materials }) => (
        <section key={block} className="playground-block" aria-label={`${block}`}>
          <BlockHeading block={block} count={materials.length} family={familyOf(block)} />
          <ul className="playground-tiles">
            {materials.map((entry) => (
              <Tile key={entry.id} entry={entry} poster={source.poster(entry)} source={source} pressed={entry.id === playing?.id} marks={marksOf(entry)} onChoose={onChoose} />
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
