// The research page's small parts, shared by its three views (research-page.tsx): a run's outcome
// mark, a condition's name, a basis group's strongest pictures, and a run's picture, which plays the
// run live while the pointer is on it.

import { useEffect, useState } from "react";
import { fill, SITE_WORDS } from "../../app/site-words";
import { useLibrary } from "../../app/library-session";
import type { FigureMaterial } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";
import { HomeMaterial } from "../home/home-material-view";
import { fetchResearchMaterial, lastStillUrl } from "./research-api";
import { outcomeClass, type Condition, type OutcomeClass, type ResearchRun } from "./research-runs";

const WORDS = SITE_WORDS.research;

/** A condition in words: "Centre disc · Guided · Coarse + fine". */
export function conditionName(condition: Condition): string {
  return `${WORDS.starts[condition.start]} · ${WORDS.losses[condition.loss]} · ${WORDS.rules[condition.rule]}`;
}

/** A measured number at three significant figures, or the dash for one not measured. */
export function measured(value: number | null): string {
  return value === null ? WORDS.notMeasured : String(Number(value.toPrecision(3)));
}

/** The mark of an outcome class: a filled square holds, a half-filled one fired, an empty one never fired. */
export function OutcomeMark({ outcome }: { outcome: OutcomeClass }) {
  return <span className="research-mark" data-outcome={outcome} role="img" aria-label={WORDS.outcomes[outcome]} />;
}

export function RunMark({ run }: { run: ResearchRun }) {
  return <OutcomeMark outcome={outcomeClass(run.outcome)} />;
}

/** A basis group's strongest public pictures, strongest first, as small thumbnails. */
export function GroupPictures({ group, count }: { group: number; count: number }) {
  const library = useLibrary();
  const [pictures, setPictures] = useState<number[]>([]);
  useEffect(() => {
    let current = true;
    void library.strongestPictures(group, count).then((found) => { if (current) setPictures(found); });
    return () => { current = false; };
  }, [library, group, count]);
  return (
    <span className="research-pictures" aria-hidden="true">
      {pictures.map((imageId) => <img key={imageId} src={library.thumbnailUrl(imageId)} alt="" loading="lazy" />)}
    </span>
  );
}

/** Files already read, so a second hover plays at once. */
const loaded = new Map<string, Promise<{ entry: MaterialEntry; material: FigureMaterial }>>();

function loadRun(run: ResearchRun) {
  let file = loaded.get(run.id);
  if (!file) {
    file = fetchResearchMaterial(run);
    file.catch(() => loaded.delete(run.id));
    loaded.set(run.id, file);
  }
  return file;
}

/**
 * A run's last still; while the pointer is on it, the run grows live from its own seed in the
 * still's place. Only the hovered run holds a replay, so a page of many runs stays light.
 */
export function RunPicture({ run, live }: { run: ResearchRun; live: boolean }) {
  const [file, setFile] = useState<{ entry: MaterialEntry; material: FigureMaterial } | null>(null);
  const [noReplay, setNoReplay] = useState(false);
  useEffect(() => {
    if (!live || noReplay) return;
    let current = true;
    void loadRun(run).then((read) => { if (current) setFile(read); }, () => {});
    return () => { current = false; };
  }, [run, live, noReplay]);
  const still = lastStillUrl(run);
  if (live && file && !noReplay) {
    return (
      <div className="research-picture">
        <HomeMaterial entry={file.entry} material={file.material} posterUrl={still ?? undefined} brush={false}
          regrowAtTick={Number.POSITIVE_INFINITY} onNoReplay={() => setNoReplay(true)} />
      </div>
    );
  }
  return (
    <div className="research-picture">
      {still ? <img src={still} alt={fill(WORDS.stillAt, { tick: run.stills.at(-1)! })} /> : null}
    </div>
  );
}
