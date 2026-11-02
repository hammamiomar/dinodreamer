// One research run (/admin/research/run/<id>): the Automata stage plays it from its own file, with
// Promote among the owner's actions beside it; beside or under the stage, the reading, the outcome,
// the settings, the stills and the provenance. Promote makes the run a pending automaton; only Approve
// on the materials page publishes it.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { FigureMaterial } from "../../materials/material-file";
import { MaterialStage, type MaterialSource } from "../../replay/material-stage";
import type { MaterialEntry } from "../gallery/material-index";
import { fetchResearchMaterial, lastStillUrl, promoteRun, stillUrl } from "./research-api";
import { conditionName, measured, RunMark } from "./research-parts";
import { useResearchView } from "./research-page";
import { conditionOf, groupSegment, type ResearchLoss, type ResearchRun, type ResearchStart } from "./research-runs";

const WORDS = SITE_WORDS.research;
const PLACE_WORDS = { pending: WORDS.onSitePending, shown: WORDS.onSiteShown, hidden: WORDS.onSiteHidden } as const;

function startWords(start: ResearchStart): string {
  if (start.kind === "noise") return WORDS.starts.noise;
  const amplitude = start.backgroundAmplitude ?? 0;
  return amplitude > 0
    ? `${WORDS.starts["seeded-field"]}, ${fill(WORDS.fieldValue, { radius: start.radius, amplitude })}`
    : `${WORDS.starts["centre-disc"]}, ${fill(WORDS.discValue, { radius: start.radius })}`;
}

/** "Guided, ratio 3, release fraction 0.4, z floor 1 (median norm)": the settings the run uses, in order. */
function lossWords(loss: ResearchLoss): string {
  if (loss.kind !== "guided") return WORDS.losses[loss.kind];
  const guide = WORDS.guide;
  const numbered = (words: string, value: number | null) => (value === null ? [] : [fill(words, { value })]);
  const parts = [
    ...numbered(guide.ratio, loss.ratio),
    ...numbered(guide.weightCap, loss.weightCap),
    ...numbered(guide.releaseFraction, loss.releaseFraction),
    ...numbered(guide.releaseAtUpdate, loss.releaseAtUpdate),
    ...numbered(guide.releaseFloor, loss.releaseFloor),
    ...(loss.reEngage === null ? [] : [loss.reEngage ? guide.reEngages : guide.staysReleased]),
    ...numbered(guide.zFloor, loss.zFloor),
  ];
  const units = loss.units === "" ? "" : ` ${fill(guide.units, { units: loss.units })}`;
  return [WORDS.losses.guided, ...parts].join(", ") + units;
}

function yesNo(value: boolean | null): string {
  return value === null ? WORDS.notMeasured : value ? WORDS.yes : WORDS.no;
}

export function ResearchRunView() {
  const { manifest, search, places } = useResearchView();
  const id = useParams().id ?? "";
  const run = manifest.runs.find((candidate) => candidate.id === id);
  const [file, setFile] = useState<{ entry: MaterialEntry; material: FigureMaterial } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!run) return;
    let current = true;
    setFile(null);
    setProblem(null);
    fetchResearchMaterial(run).then(
      (read) => { if (current) setFile(read); },
      (error: unknown) => { if (current) setProblem(error instanceof Error ? error.message : String(error)); },
    );
    return () => { current = false; };
  }, [run]);
  if (!run) return <p className="research-missing">{fill(WORDS.unknownRun, { id })}</p>;
  const study = manifest.studies.find((candidate) => candidate.id === run.study);
  const place = places.get(run.id);
  const groupName = run.group === null ? WORDS.noGroup : fill(WORDS.backToGroup, { group: run.group });
  return (
    <section className="research-run" aria-label={run.id}>
      <p className="research-back">
        <Link to={`/admin/research${search}`}>{WORDS.allGroups}</Link>
        <Link to={`/admin/research/group/${groupSegment(run.group)}${search}`}>{groupName}</Link>
      </p>
      <header className="research-run-head">
        <h2 className="heading">{run.id}</h2>
        <p><RunMark run={run} /> {conditionName(conditionOf(run))}{place && <> · <span className="research-place">{PLACE_WORDS[place]}</span></>}</p>
      </header>
      {problem && <p role="alert">{problem}</p>}
      <div className="research-run-body">
        {file ? <RunStage run={run} file={file} /> : <div className="research-stage" />}
        <div className="research-facts">
          <section>
            <h3 className="label">{WORDS.reading}</h3>
            <p className="research-reading">{run.reading.line || WORDS.notMeasured}</p>
            {run.reading.tags.length > 0 && <p className="research-card-tags">{run.reading.tags.join(" · ")}</p>}
            {study && <p className="research-study-question">{fill(WORDS.studyLine, { date: study.date, title: study.title, count: manifest.runs.filter((candidate) => candidate.study === study.id).length })}<br />{study.question}</p>}
          </section>
          <section>
            <h3 className="label">{WORDS.outcome}</h3>
            <dl className="research-table">
              <dt>{WORDS.firesAt}</dt><dd>{run.outcome.firesAtUpdate ?? WORDS.cardNeverFired}</dd>
              <dt>{WORDS.holds}</dt><dd>{yesNo(run.outcome.holds4000)}</dd>
              <dt>{WORDS.centreSelected}</dt>
              <dd>{run.outcome.centreSelected ? fill(WORDS.centreValue, run.outcome.centreSelected) : WORDS.notMeasured}</dd>
              <dt>{WORDS.requestLoss}</dt><dd>{measured(run.outcome.requestLoss)}</dd>
              <dt>{WORDS.releasedAt}</dt><dd>{run.outcome.releasedAtUpdate ?? WORDS.notMeasured}</dd>
              <dt>{WORDS.guideLossAtRelease}</dt><dd>{measured(run.outcome.guideLossAtRelease)}</dd>
              <dt>{WORDS.guideLossEnd}</dt><dd>{measured(run.outcome.guideLossEnd)}</dd>
              <dt>{WORDS.naturalRoute}</dt><dd>{yesNo(run.outcome.naturalRouteKept)}</dd>
            </dl>
          </section>
          <section>
            <h3 className="label">{WORDS.dials}</h3>
            <dl className="research-table">
              <dt>{WORDS.study}</dt><dd>{study ? `${study.date} · ${study.title}` : run.study}</dd>
              <dt>{WORDS.start}</dt><dd>{startWords(run.start)}</dd>
              <dt>{WORDS.loss}</dt><dd>{lossWords(run.loss)}</dd>
              {run.lossRegion && <><dt>{WORDS.lossRegion}</dt><dd>{WORDS.regions[run.lossRegion]}</dd></>}
              {run.request && <><dt>{WORDS.request}</dt><dd>{run.request}</dd></>}
              <dt>{WORDS.rule}</dt><dd>{WORDS.rules[run.rule]}</dd>
              <dt>{WORDS.seed}</dt><dd>{run.seed}</dd>
              <dt>{WORDS.schedule}</dt><dd>{fill(WORDS.scheduleValue, { updates: run.schedule.updates, pool: run.schedule.pool })}</dd>
            </dl>
          </section>
          {run.stills.length > 0 && (
            <section>
              <h3 className="label">{WORDS.stills}</h3>
              <div className="research-stills">
                {run.stills.map((tick) => (
                  <figure key={tick}>
                    <img src={stillUrl(run, tick)} alt={fill(WORDS.stillAt, { tick })} />
                    <figcaption>{fill(WORDS.stillAt, { tick })}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3 className="label">{WORDS.provenance}</h3>
            <dl className="research-table">
              <dt>{WORDS.materialSha256}</dt><dd className="research-hash">{run.materialSha256}</dd>
              {run.machine && <><dt>{WORDS.machine}</dt><dd>{run.machine}</dd></>}
            </dl>
            <p className="research-made">{fill(WORDS.madeFrom, { made: manifest.generatedAt, commit: manifest.researchCommit })}</p>
          </section>
        </div>
      </div>
    </section>
  );
}

/** The Automata stage on the run's file, with Promote in the owner's place beside it. */
function RunStage({ run, file }: { run: ResearchRun; file: { entry: MaterialEntry; material: FigureMaterial } }) {
  // One source per file: the stage reads its material again when the source changes.
  const source = useMemo<MaterialSource>(() => ({
    load: () => Promise.resolve(file.material),
    poster: () => lastStillUrl(run) ?? "",
    keepable: () => false,
  }), [run, file]);
  return (
    <div className="research-stage">
      <MaterialStage entries={[file.entry]} source={source} layout="instrument" ownerActions={<Promote run={run} />} />
    </div>
  );
}

function Promote({ run }: { run: ResearchRun }) {
  const { refreshPlaces } = useResearchView();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<{ status: "idle" } | { status: "promoting" } | { status: "done"; id: string } | { status: "failed"; message: string }>({ status: "idle" });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setState({ status: "promoting" });
    promoteRun(run, title).then(
      (id) => { setState({ status: "done", id }); refreshPlaces(); },
      (error: unknown) => setState({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <form className="research-promote" onSubmit={submit}>
      <label>
        <span className="label">{WORDS.promoteTitle}</span>
        <input type="text" value={title} maxLength={80} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <button type="submit" className="button" disabled={state.status === "promoting" || title.trim() === ""}>
        {state.status === "promoting" ? WORDS.promoting : WORDS.promote}
      </button>
      <p className="research-promote-note" role="status">
        {state.status === "done" && <>{fill(WORDS.promoted, { id: state.id })} <Link to="/admin/materials">{WORDS.materialsPage}</Link></>}
        {state.status === "failed" && fill(WORDS.promoteFailed, { message: state.message })}
        {(state.status === "idle" || state.status === "promoting") && WORDS.promoteHint}
      </p>
    </form>
  );
}
