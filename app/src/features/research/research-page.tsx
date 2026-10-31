// The owner's research page (/admin/research): every research run the research repository
// published to the private bucket (gallery/research.ts), arranged in three views from the whole to
// one run. The overview is one row per basis group and one column per condition (start × loss ×
// rule); a group's view lays out its runs by condition; a run's view plays it, with every setting,
// outcome and the reading, and promotes it. The filters (studies, tags, outcome) live in the
// address and apply to every view. The rules are research-runs.ts; the Worker serves this page
// only after its owner check (gallery/src/admin.ts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useMatch, useOutletContext, useSearchParams } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { fetchResearchManifest, fetchSitePlaces, type SitePlace } from "./research-api";
import { OutcomeMark } from "./research-parts";
import {
  filterSearch, matchesFilter, OUTCOME_CLASSES, readFilter, tagsInUse, type OutcomeClass, type ResearchFilter, type ResearchManifest,
} from "./research-runs";
import "./research.css";

const WORDS = SITE_WORDS.research;

/** What the three views share: the index, the filter as read from the address, and the runs' places on the site. */
export interface ResearchView {
  manifest: ResearchManifest;
  filter: ResearchFilter;
  /** The filter as a search string, for links between the views. */
  search: string;
  places: ReadonlyMap<string, SitePlace>;
  /** Read the places again after a promotion. */
  refreshPlaces: () => void;
}

export function useResearchView(): ResearchView {
  return useOutletContext<ResearchView>();
}

type Read = { status: "loading" } | { status: "failed"; message: string } | { status: "empty" } | { status: "ready"; manifest: ResearchManifest };

export function ResearchPage() {
  const [read, setRead] = useState<Read>({ status: "loading" });
  const [places, setPlaces] = useState<ReadonlyMap<string, SitePlace>>(new Map());
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => readFilter(searchParams), [searchParams]);
  // The overview shows the studies with their questions; a group's view a line of study chips; a run's view no filter.
  const overview = useMatch("/admin/research") !== null;
  const runView = useMatch("/admin/research/run/:id") !== null;

  useEffect(() => {
    fetchResearchManifest().then(
      (manifest) => setRead(manifest === null ? { status: "empty" } : { status: "ready", manifest }),
      (error: unknown) => setRead({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
  }, []);
  // The places only mark runs already on the site; the page works without them.
  const refreshPlaces = useCallback(() => {
    fetchSitePlaces().then(setPlaces, () => {});
  }, []);
  useEffect(refreshPlaces, [refreshPlaces]);

  if (read.status !== "ready") {
    const message = read.status === "loading" ? WORDS.loading : read.status === "empty" ? WORDS.nothingYet : fill(WORDS.failed, { message: read.message });
    return <main className="page research"><ResearchHeading /><p role={read.status === "failed" ? "alert" : undefined}>{message}</p></main>;
  }
  const { manifest } = read;
  const view: ResearchView = { manifest, filter, search: filterSearch(filter), places, refreshPlaces };
  const setFilter = (next: ResearchFilter) => setSearchParams(new URLSearchParams(filterSearch(next)), { preventScrollReset: true });
  return (
    <main className="page research">
      <ResearchHeading manifest={manifest} />
      {!runView && <Filters manifest={manifest} filter={filter} onChange={setFilter} compact={!overview} />}
      <Outlet context={view} />
    </main>
  );
}

function ResearchHeading({ manifest }: { manifest?: ResearchManifest }) {
  return (
    <header className="research-head">
      <p className="label research-links">
        <Link to="/admin">{SITE_WORDS.owner.ownerPage}</Link>
        <Link to="/admin/materials">{WORDS.materialsPage}</Link>
      </p>
      <h1 className="heading">{WORDS.heading}</h1>
      {manifest && (
        <>
          <p className="research-counts">{fill(WORDS.counts, {
            runs: manifest.runs.length, studies: manifest.studies.length, groups: new Set(manifest.runs.map((run) => run.group)).size,
          })}</p>
          <p className="research-made">{fill(WORDS.madeFrom, { made: manifest.generatedAt, commit: manifest.researchCommit })}</p>
        </>
      )}
    </header>
  );
}

/** Toggle one value in a filter list. */
function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

/**
 * The filters: the studies, newest first, each with its question; the tags the runs use; the
 * outcome classes with their marks. Pressed values narrow every view; none pressed keeps all.
 */
function Filters({ manifest, filter, onChange, compact }: {
  manifest: ResearchManifest;
  filter: ResearchFilter;
  onChange: (filter: ResearchFilter) => void;
  /** Studies as a line of chips, each question in its title, in place of the list. */
  compact: boolean;
}) {
  const studies = [...manifest.studies].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  for (const run of manifest.runs) counts.set(run.study, (counts.get(run.study) ?? 0) + 1);
  const tags = tagsInUse(manifest.runs);
  const shown = manifest.runs.filter((run) => matchesFilter(run, filter)).length;
  const filtering = filter.studies.length + filter.tags.length + filter.outcomes.length > 0;
  return (
    <section className="research-filters" data-compact={compact || undefined} aria-label={WORDS.studiesLabel}>
      {compact ? (
        <div className="research-chip-row" role="group" aria-label={WORDS.studiesLabel}>
          <p className="label">{WORDS.studiesLabel}</p>
          {studies.map((study) => (
            <button key={study.id} type="button" className="chip" title={study.question} aria-pressed={filter.studies.includes(study.id)}
              onClick={() => onChange({ ...filter, studies: toggled(filter.studies, study.id) })}>
              {study.date} · {study.title}
            </button>
          ))}
        </div>
      ) : (
        <div className="research-studies">
          <p className="label">{WORDS.studiesLabel}</p>
          <ul>
            {studies.map((study) => (
              <li key={study.id}>
                <button type="button" className="research-study" aria-pressed={filter.studies.includes(study.id)}
                  onClick={() => onChange({ ...filter, studies: toggled(filter.studies, study.id) })}>
                  <span className="research-study-line">{fill(WORDS.studyLine, { date: study.date, title: study.title, count: counts.get(study.id) ?? 0 })}</span>
                  <span className="research-study-question">{study.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="research-chips">
        <div className="research-chip-row" role="group" aria-label={WORDS.outcomesLabel}>
          <p className="label">{WORDS.outcomesLabel}</p>
          {OUTCOME_CLASSES.map((outcome: OutcomeClass) => (
            <button key={outcome} type="button" className="chip" aria-pressed={filter.outcomes.includes(outcome)}
              onClick={() => onChange({ ...filter, outcomes: toggled(filter.outcomes, outcome) })}>
              <OutcomeMark outcome={outcome} />{WORDS.outcomes[outcome]}
            </button>
          ))}
        </div>
        {tags.length > 0 && (
          <div className="research-chip-row" role="group" aria-label={WORDS.tagsLabel}>
            <p className="label">{WORDS.tagsLabel}</p>
            {tags.map((tag) => (
              <button key={tag} type="button" className="chip" aria-pressed={filter.tags.includes(tag)}
                onClick={() => onChange({ ...filter, tags: toggled(filter.tags, tag) })}>{tag}</button>
            ))}
          </div>
        )}
        <p className="research-shown">
          {fill(WORDS.filtered, { shown, runs: manifest.runs.length })}
          {filtering && <button type="button" className="chip" onClick={() => onChange({ studies: [], tags: [], outcomes: [] })}>{WORDS.clearFilter}</button>}
        </p>
      </div>
    </section>
  );
}
