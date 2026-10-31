// One basis group's runs (/admin/research/group/<n>, or group/none for the runs without one): a row
// per start and rule, a column per loss, so plain and guided runs of the same start sit side by side.
// Each cell holds its filtered runs as cards, newest study first; a card plays its run while the
// pointer is on it and opens the run's view. The rows and columns come from all the group's runs, so
// a filter never moves them. A cell's id is its condition key: the overview links straight to it.

import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { GroupPictures, RunMark, RunPicture } from "./research-parts";
import { useResearchView } from "./research-page";
import {
  conditionKey, conditionOf, groupRuns, LOSS_KINDS, RULES, START_CLASSES, type LossKind, type ResearchRun, type ResearchRule, type StartClass,
} from "./research-runs";

const WORDS = SITE_WORDS.research;
const PLACE_WORDS = { pending: WORDS.onSitePending, shown: WORDS.onSiteShown, hidden: WORDS.onSiteHidden } as const;

export function ResearchGroup() {
  const { manifest, filter, search } = useResearchView();
  const segment = useParams().block ?? "";
  const group = segment === "none" ? null : Number(segment);
  const all = manifest.runs.filter((run) => run.group === group);
  const { hash } = useLocation();
  // The overview's cell links to its condition here.
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [hash]);
  if (all.length === 0) {
    return <p className="research-missing">{fill(WORDS.unknownGroup, { group: segment })}</p>;
  }
  const shown = groupRuns(manifest, filter).find((row) => row.group === group);
  const conditions = all.map(conditionOf);
  const rows: { start: StartClass; rule: ResearchRule }[] = START_CLASSES.flatMap((start) =>
    RULES.filter((rule) => conditions.some((condition) => condition.start === start && condition.rule === rule)).map((rule) => ({ start, rule })));
  const losses: LossKind[] = LOSS_KINDS.filter((loss) => conditions.some((condition) => condition.loss === loss));
  const name = all.find((run) => run.groupName !== "")?.groupName ?? "";
  return (
    <section className="research-group" aria-label={group === null ? WORDS.noGroup : fill(WORDS.groupHeading, { group })}>
      <p className="research-back"><Link to={`/admin/research${search}`}>{WORDS.allGroups}</Link></p>
      <header className="research-group-head">
        <h2 className="heading">{group === null ? WORDS.noGroup : fill(WORDS.groupHeading, { group })}</h2>
        {name && <p className="research-group-name">{name}</p>}
        {group !== null && <GroupPictures group={group} count={8} />}
      </header>
      <div className="research-board" style={{ gridTemplateColumns: `128px repeat(${losses.length}, minmax(0, 1fr))` }}>
        <span />
        {losses.map((loss) => <p key={loss} className="label research-board-loss">{WORDS.losses[loss]}</p>)}
        {rows.map(({ start, rule }) => (
          <BoardRow key={`${start}/${rule}`} start={start} rule={rule} losses={losses}
            runsOf={(loss) => shown?.byCondition.get(conditionKey({ start, loss, rule })) ?? []} />
        ))}
      </div>
    </section>
  );
}

function BoardRow({ start, rule, losses, runsOf }: { start: StartClass; rule: ResearchRule; losses: LossKind[]; runsOf: (loss: LossKind) => ResearchRun[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <>
      <p className="research-board-row">
        <span>{WORDS.starts[start]}</span>
        <span className="label">{WORDS.rules[rule]}</span>
      </p>
      {losses.map((loss) => {
        const runs = runsOf(loss);
        return (
          <div key={loss} id={conditionKey({ start, loss, rule })} className="research-board-cell">
            {runs.length === 0 ? <p className="research-none">{WORDS.noRunsHere}</p> : runs.map((run) => (
              <RunCard key={run.id} run={run} live={hovered === run.id}
                onPointerEnter={() => setHovered(run.id)} onPointerLeave={() => setHovered((current) => (current === run.id ? null : current))} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function RunCard({ run, live, onPointerEnter, onPointerLeave }: { run: ResearchRun; live: boolean; onPointerEnter: () => void; onPointerLeave: () => void }) {
  const { search, places, manifest } = useResearchView();
  const place = places.get(run.id);
  const study = manifest.studies.find((candidate) => candidate.id === run.study);
  const fired = run.outcome.firesAtUpdate;
  return (
    <Link className="research-card" to={`/admin/research/run/${run.id}${search}`} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}
      onFocus={onPointerEnter} onBlur={onPointerLeave}>
      <RunPicture run={run} live={live} />
      <span className="research-card-line">
        <RunMark run={run} />
        {fill(WORDS.cardSeed, { seed: run.seed })} · {fired === null ? WORDS.cardNeverFired : fill(WORDS.cardFired, { update: fired })}
      </span>
      <span className="research-card-line research-card-study">
        {study?.date ?? run.study}{place && <> · <span className="research-place">{PLACE_WORDS[place]}</span></>}
      </span>
      {run.reading.line && <span className="research-card-reading">{run.reading.line}</span>}
      {run.reading.tags.length > 0 && <span className="research-card-tags">{run.reading.tags.join(" · ")}</span>}
    </Link>
  );
}
