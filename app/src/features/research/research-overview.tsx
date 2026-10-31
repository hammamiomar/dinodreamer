// The research page's overview (/admin/research): one row per basis group, one column per condition
// the index has runs for, grouped by start. A cell shows each filtered run as its outcome mark and
// how many fired; it opens the group's view at that condition. The columns come from every run, not
// the filtered ones, so a filter never moves them.

import { Link } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import { conditionName, GroupPictures, RunMark } from "./research-parts";
import { useResearchView } from "./research-page";
import { conditionKey, conditionOf, CONDITIONS, groupRuns, groupSegment, outcomeClass, START_CLASSES, type Condition, type ResearchRun } from "./research-runs";

const WORDS = SITE_WORDS.research;
/** The marks a cell draws before it counts the rest: about a row of a cell's width. */
const MOST_MARKS = 12;

export function ResearchOverview() {
  const { manifest, filter, search } = useResearchView();
  const present = new Set(manifest.runs.map((run) => conditionKey(conditionOf(run))));
  const columns = CONDITIONS.filter((condition) => present.has(conditionKey(condition)));
  const starts = START_CLASSES.map((start) => ({ start, span: columns.filter((condition) => condition.start === start).length })).filter(({ span }) => span > 0);
  const rows = groupRuns(manifest, filter);
  return (
    <div className="research-overview">
      <table className="research-matrix">
        <thead>
          <tr>
            <th rowSpan={2} scope="col" className="label">{WORDS.groupColumn}</th>
            {starts.map(({ start, span }) => <th key={start} colSpan={span} scope="colgroup" className="label research-start">{WORDS.starts[start]}</th>)}
          </tr>
          <tr>
            {columns.map((condition) => (
              <th key={conditionKey(condition)} scope="col" className="research-condition" title={conditionName(condition)}>
                <span>{WORDS.losses[condition.loss]}</span>
                <span>{WORDS.rules[condition.rule]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={groupSegment(row.group)}>
              <th scope="row">
                <Link className="research-group-link" to={`group/${groupSegment(row.group)}${search}`}>
                  <span className="research-group-number">{row.group ?? WORDS.noGroup}</span>
                  {row.name && <span className="research-group-name">{row.name}</span>}
                  {row.group !== null && <GroupPictures group={row.group} count={4} />}
                </Link>
              </th>
              {columns.map((condition) => <Cell key={conditionKey(condition)} group={row.group} condition={condition} runs={row.byCondition.get(conditionKey(condition)) ?? []} search={search} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ group, condition, runs, search }: { group: number | null; condition: Condition; runs: ResearchRun[]; search: string }) {
  if (runs.length === 0) return <td className="research-cell" data-empty />;
  const fired = runs.filter((run) => outcomeClass(run.outcome) !== "never-fired").length;
  return (
    <td className="research-cell">
      <Link to={`group/${groupSegment(group)}${search}#${conditionKey(condition)}`}
        aria-label={fill(WORDS.cellName, { group: group ?? WORDS.noGroup, condition: conditionName(condition), runs: runs.length, fired })}>
        <span className="research-marks">
          {runs.slice(0, MOST_MARKS).map((run) => <RunMark key={run.id} run={run} />)}
          {runs.length > MOST_MARKS && <span className="research-more">+{runs.length - MOST_MARKS}</span>}
        </span>
        <span className="research-cell-count">{fill(WORDS.cellCount, { fired, runs: runs.length })}</span>
      </Link>
    </td>
  );
}
