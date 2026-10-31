// The research runs on the owner's research page (/admin/research, research-page.tsx): the run
// index that the research repository exports, research/manifest.json in the private bucket, and the
// rules that arrange it. A run's condition is its start, loss and rule; its outcome class is read
// from its outcome; filters come from the address. The gallery Worker and its publish command
// (gallery/research.ts) check the same file with readResearchManifest. This module has no browser
// or React imports.

/** The run index in the private bucket. Each run's files are under research/runs/<id>/. */
export const RESEARCH_MANIFEST_KEY = "research/manifest.json";
/** The largest manifest the publish command and the page accept: about 300 bytes a run leaves room for thousands. */
export const RESEARCH_MANIFEST_BYTES = 4 * 1024 * 1024;

/** A day's experiment: its runs share the study id. */
export interface ResearchStudy {
  id: string;
  /** The day the runs were trained, YYYY-MM-DD. */
  date: string;
  title: string;
  /** The question the study asks, in one or two sentences. */
  question: string;
}

/**
 * The state a run grew from, as the trainer drew it: uniform noise in [-0.5, 0.5) on every channel,
 * or that noise inside a disc of `radius` cells at the grid centre and `backgroundAmplitude` times it
 * outside (0 or absent: zero outside).
 */
export type ResearchStart = { kind: "noise" } | { kind: "centre-disc"; radius: number; backgroundAmplitude?: number };

/**
 * The training loss: the request alone; the request with a guide that is released during training;
 * the request with a selection margin; or another objective.
 */
export type ResearchLoss =
  | { kind: "plain" }
  | { kind: "guided"; ratio: number; releaseFraction: number; zFloor: number; units: string }
  | { kind: "plain-margin" }
  | { kind: "other" };

export type ResearchRule = "cell" | "pyramid";

/** The run's measurements. Null means the run did not measure it, except firesAtUpdate: null there means it never fired. */
export interface ResearchOutcome {
  /** The update at which the guide was released. */
  releasedAtUpdate: number | null;
  requestLoss: number | null;
  /** The central patches whose 32 selections include the group, of the patches counted. */
  centreSelected: { count: number; of: number } | null;
  /** Whether the route the run found without the guide was kept after the release. */
  naturalRouteKept: boolean | null;
  guideLossAtRelease: number | null;
  guideLossEnd: number | null;
  /** The first update whose reading met the selection target; null when none did. */
  firesAtUpdate: number | null;
  /** Whether the replay still met the selection target at tick 4,000. */
  holds4000: boolean | null;
}

export interface ResearchRun {
  /** The entry-id form (isResearchRunId), so a promoted run keeps a readable id in the logs. */
  id: string;
  study: string;
  /** The basis group the run trains toward; null for an objective without one. */
  group: number | null;
  /** The group's name in the researcher's words; empty when it has none. */
  groupName: string;
  start: ResearchStart;
  loss: ResearchLoss;
  /** The patches the loss scores: the 16 centre tokens or the whole field; null when the export does not say. */
  lossRegion: "centre" | "field" | null;
  /** The request's statistic, such as "strongest-mean" or "median-norm"; null when the export does not say. */
  request: string | null;
  /** Where the run trained, such as "alienware"; null when unknown. */
  machine: string | null;
  rule: ResearchRule;
  seed: number;
  schedule: { updates: number; pool: number };
  outcome: ResearchOutcome;
  /** The researcher's one-line reading, and short tags such as "texture" or "colour-only". */
  reading: { line: string; tags: string[] };
  /** SHA-256 of research/runs/<id>/material.json, the run's format-4 file. */
  materialSha256: string;
  /** The ticks with a still under research/runs/<id>/ (stillName), ascending. */
  stills: number[];
}

export interface ResearchManifest {
  format: 1;
  generatedAt: string;
  researchCommit: string;
  dictionaryId: string;
  studies: ResearchStudy[];
  runs: ResearchRun[];
}

/** Lower-case letters, digits and hyphens, as published entry ids are (gallery/material-index.ts). */
export function isResearchRunId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,95}$/.test(id);
}

/** still-0200.png: the still of a run at a tick. */
export function stillName(tick: number): string {
  return `still-${String(tick).padStart(4, "0")}.png`;
}

/** A run's object in the private bucket: its format-4 file or one of its stills. */
export function researchRunKey(id: string, file: string): string {
  return `research/runs/${id}/${file}`;
}

// The run index as exported: every field is checked once, here, at the boundary.

const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MOST_TEXT = 400;
/** The library's basis groups, 0 to 16,383. */
const GROUPS = 16384;

class ManifestError extends Error {}

function fail(where: string, problem: string): never {
  throw new ManifestError(`research manifest: ${where}: ${problem}`);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(where, "must be an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string, most = MOST_TEXT): string {
  if (typeof value !== "string" || value.length > most) fail(where, `must be text of at most ${most} characters`);
  return value;
}

function count(value: unknown, where: string, most = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > most) fail(where, `must be a whole number from 0 to ${most}`);
  return value as number;
}

function finite(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(where, "must be a finite number");
  return value;
}

function nullable<T>(value: unknown, read: (present: unknown) => T): T | null {
  return value === null ? null : read(value);
}

function flag(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") fail(where, "must be true or false");
  return value;
}

function readStart(value: unknown, where: string): ResearchStart {
  const start = record(value, where);
  if (start.kind === "noise") return { kind: "noise" };
  if (start.kind !== "centre-disc") fail(where, 'kind must be "noise" or "centre-disc"');
  const radius = finite(start.radius, `${where}.radius`);
  if (radius <= 0 || radius > 256) fail(`${where}.radius`, "must be more than 0 and at most 256 cells");
  if (start.backgroundAmplitude === undefined) return { kind: "centre-disc", radius };
  const backgroundAmplitude = finite(start.backgroundAmplitude, `${where}.backgroundAmplitude`);
  if (backgroundAmplitude < 0 || backgroundAmplitude > 1) fail(`${where}.backgroundAmplitude`, "must be from 0 to 1");
  return { kind: "centre-disc", radius, backgroundAmplitude };
}

function readLoss(value: unknown, where: string): ResearchLoss {
  const loss = record(value, where);
  if (loss.kind === "plain" || loss.kind === "plain-margin" || loss.kind === "other") return { kind: loss.kind };
  if (loss.kind !== "guided") fail(where, 'kind must be "plain", "guided", "plain-margin" or "other"');
  return {
    kind: "guided",
    ratio: finite(loss.ratio, `${where}.ratio`),
    releaseFraction: finite(loss.releaseFraction, `${where}.releaseFraction`),
    zFloor: finite(loss.zFloor, `${where}.zFloor`),
    units: text(loss.units, `${where}.units`),
  };
}

function readOutcome(value: unknown, where: string): ResearchOutcome {
  const outcome = record(value, where);
  const centre = nullable(outcome.centreSelected, (present) => {
    const selected = record(present, `${where}.centreSelected`);
    const of = count(selected.of, `${where}.centreSelected.of`, 256);
    return { count: count(selected.count, `${where}.centreSelected.count`, of), of };
  });
  return {
    releasedAtUpdate: nullable(outcome.releasedAtUpdate, (present) => count(present, `${where}.releasedAtUpdate`)),
    requestLoss: nullable(outcome.requestLoss, (present) => finite(present, `${where}.requestLoss`)),
    centreSelected: centre,
    naturalRouteKept: nullable(outcome.naturalRouteKept, (present) => flag(present, `${where}.naturalRouteKept`)),
    guideLossAtRelease: nullable(outcome.guideLossAtRelease, (present) => finite(present, `${where}.guideLossAtRelease`)),
    guideLossEnd: nullable(outcome.guideLossEnd, (present) => finite(present, `${where}.guideLossEnd`)),
    firesAtUpdate: nullable(outcome.firesAtUpdate, (present) => count(present, `${where}.firesAtUpdate`)),
    holds4000: nullable(outcome.holds4000, (present) => flag(present, `${where}.holds4000`)),
  };
}

function readRun(value: unknown, at: number, studies: ReadonlySet<string>): ResearchRun {
  const run = record(value, `runs[${at}]`);
  const id = text(run.id, `runs[${at}].id`, 96);
  if (!isResearchRunId(id)) fail(`runs[${at}].id`, "must be lower-case letters, digits and hyphens");
  const where = `run ${id}`;
  const study = text(run.study, `${where}.study`);
  if (!studies.has(study)) fail(`${where}.study`, `names no study in the manifest: ${study}`);
  if (run.rule !== "cell" && run.rule !== "pyramid") fail(`${where}.rule`, 'must be "cell" or "pyramid"');
  const schedule = record(run.schedule, `${where}.schedule`);
  const reading = record(run.reading, `${where}.reading`);
  if (!Array.isArray(reading.tags)) fail(`${where}.reading.tags`, "must be a list");
  const tags = reading.tags.map((tag, index) => {
    if (typeof tag !== "string" || !TAG.test(tag)) fail(`${where}.reading.tags[${index}]`, "must be a short lower-case word");
    return tag;
  });
  const materialSha256 = text(run.materialSha256, `${where}.materialSha256`, 64);
  if (!SHA256.test(materialSha256)) fail(`${where}.materialSha256`, "must be 64 lower-case hex digits");
  if (!Array.isArray(run.stills)) fail(`${where}.stills`, "must be a list of ticks");
  const stills = run.stills.map((tick, index) => count(tick, `${where}.stills[${index}]`, 99999));
  if (!stills.every((tick, index) => index === 0 || tick > stills[index - 1]!)) fail(`${where}.stills`, "must be ascending without repeats");
  const lossRegion = run.lossRegion ?? null;
  if (lossRegion !== null && lossRegion !== "centre" && lossRegion !== "field") fail(`${where}.lossRegion`, 'must be "centre", "field" or null');
  return {
    id,
    study,
    group: nullable(run.group, (present) => count(present, `${where}.group`, GROUPS - 1)),
    groupName: text(run.groupName ?? "", `${where}.groupName`, 80),
    start: readStart(run.start, `${where}.start`),
    loss: readLoss(run.loss, `${where}.loss`),
    lossRegion,
    request: nullable(run.request ?? null, (present) => text(present, `${where}.request`, 40)),
    machine: nullable(run.machine ?? null, (present) => text(present, `${where}.machine`, 40)),
    rule: run.rule,
    seed: count(run.seed, `${where}.seed`, 0xffffffff),
    schedule: { updates: count(schedule.updates, `${where}.schedule.updates`), pool: count(schedule.pool, `${where}.schedule.pool`) },
    outcome: readOutcome(run.outcome, `${where}.outcome`),
    reading: { line: text(reading.line, `${where}.reading.line`), tags },
    materialSha256,
    stills,
  };
}

/** The run index, checked field by field; an error names the run and the field. */
export function readResearchManifest(value: unknown): ResearchManifest {
  const manifest = record(value, "the file");
  if (manifest.format !== 1) fail("format", "must be 1");
  if (!Array.isArray(manifest.studies)) fail("studies", "must be a list");
  const studies = manifest.studies.map((value, at): ResearchStudy => {
    const study = record(value, `studies[${at}]`);
    const date = text(study.date, `studies[${at}].date`, 10);
    if (!DATE.test(date)) fail(`studies[${at}].date`, "must be YYYY-MM-DD");
    return { id: text(study.id, `studies[${at}].id`, 96), date, title: text(study.title, `studies[${at}].title`), question: text(study.question, `studies[${at}].question`) };
  });
  const studyIds = new Set(studies.map((study) => study.id));
  if (studyIds.size !== studies.length) fail("studies", "repeat an id");
  if (!Array.isArray(manifest.runs)) fail("runs", "must be a list");
  const runs = manifest.runs.map((value, at) => readRun(value, at, studyIds));
  if (new Set(runs.map((run) => run.id)).size !== runs.length) fail("runs", "repeat an id");
  return {
    format: 1,
    generatedAt: text(manifest.generatedAt, "generatedAt", 40),
    researchCommit: text(manifest.researchCommit, "researchCommit", 64),
    dictionaryId: text(manifest.dictionaryId, "dictionaryId", 96),
    studies,
    runs,
  };
}

// The arrangement: conditions, outcome classes and filters.

/** A seeded field is a centre disc on a background of weaker noise. */
export type StartClass = "noise" | "centre-disc" | "seeded-field";
export type LossKind = ResearchLoss["kind"];
export interface Condition { start: StartClass; loss: LossKind; rule: ResearchRule }

export const START_CLASSES: readonly StartClass[] = ["noise", "centre-disc", "seeded-field"];
export const LOSS_KINDS: readonly LossKind[] = ["plain", "guided", "plain-margin", "other"];
export const RULES: readonly ResearchRule[] = ["cell", "pyramid"];

/** Every condition in the page's order: start, then loss, then rule. */
export const CONDITIONS: readonly Condition[] = START_CLASSES.flatMap((start) =>
  LOSS_KINDS.flatMap((loss) => RULES.map((rule) => ({ start, loss, rule }))));

export function startClass(start: ResearchStart): StartClass {
  if (start.kind === "noise") return "noise";
  return (start.backgroundAmplitude ?? 0) > 0 ? "seeded-field" : "centre-disc";
}

export function conditionOf(run: ResearchRun): Condition {
  return { start: startClass(run.start), loss: run.loss.kind, rule: run.rule };
}

export function conditionKey(condition: Condition): string {
  return `${condition.start}/${condition.loss}/${condition.rule}`;
}

/**
 * How a run turned out, for its mark: it fired and still met the target at tick 4,000, it fired
 * and did not (or that was not measured), or it never fired.
 */
export type OutcomeClass = "holds" | "fired" | "never-fired";
export const OUTCOME_CLASSES: readonly OutcomeClass[] = ["holds", "fired", "never-fired"];

export function outcomeClass(outcome: ResearchOutcome): OutcomeClass {
  if (outcome.firesAtUpdate === null) return "never-fired";
  return outcome.holds4000 === true ? "holds" : "fired";
}

/** The page's filters, from the address; an empty list keeps every value. */
export interface ResearchFilter {
  studies: string[];
  tags: string[];
  outcomes: OutcomeClass[];
}

const FILTER_PARAMETERS = { studies: "study", tags: "tag", outcomes: "outcome" } as const;

export function readFilter(search: URLSearchParams): ResearchFilter {
  const list = (name: string) => (search.get(name) ?? "").split(",").filter((value) => value !== "");
  return {
    studies: list(FILTER_PARAMETERS.studies),
    tags: list(FILTER_PARAMETERS.tags),
    outcomes: list(FILTER_PARAMETERS.outcomes).filter((value): value is OutcomeClass => (OUTCOME_CLASSES as readonly string[]).includes(value)),
  };
}

/** The filter as a search string ("?study=a,b&tag=texture"), or "" for no filter. */
export function filterSearch(filter: ResearchFilter): string {
  const search = new URLSearchParams();
  for (const [field, name] of Object.entries(FILTER_PARAMETERS) as [keyof ResearchFilter, string][]) {
    if (filter[field].length > 0) search.set(name, filter[field].join(","));
  }
  const query = search.toString().replaceAll("%2C", ",");
  return query === "" ? "" : `?${query}`;
}

export function matchesFilter(run: ResearchRun, filter: ResearchFilter): boolean {
  return (filter.studies.length === 0 || filter.studies.includes(run.study))
    && (filter.tags.length === 0 || filter.tags.some((tag) => run.reading.tags.includes(tag)))
    && (filter.outcomes.length === 0 || filter.outcomes.includes(outcomeClass(run.outcome)));
}

/** A basis group's runs, by condition, newest first in each; group null holds the runs without one. */
export interface GroupRuns {
  group: number | null;
  name: string;
  runs: ResearchRun[];
  byCondition: Map<string, ResearchRun[]>;
}

/**
 * The runs that pass the filter, one row per basis group in ascending group order, the runs without
 * a group last. Within a condition, runs come newest study first, then by seed. A group's name is
 * the first one given.
 */
export function groupRuns(manifest: ResearchManifest, filter: ResearchFilter): GroupRuns[] {
  const dates = new Map(manifest.studies.map((study) => [study.id, study.date]));
  const newestFirst = (a: ResearchRun, b: ResearchRun) =>
    (dates.get(b.study) ?? "").localeCompare(dates.get(a.study) ?? "") || a.seed - b.seed || a.id.localeCompare(b.id);
  const rows = new Map<number | null, GroupRuns>();
  for (const run of manifest.runs.filter((candidate) => matchesFilter(candidate, filter)).sort(newestFirst)) {
    let row = rows.get(run.group);
    if (!row) {
      row = { group: run.group, name: "", runs: [], byCondition: new Map() };
      rows.set(run.group, row);
    }
    if (row.name === "" && run.groupName !== "") row.name = run.groupName;
    row.runs.push(run);
    const key = conditionKey(conditionOf(run));
    row.byCondition.set(key, [...(row.byCondition.get(key) ?? []), run]);
  }
  return [...rows.values()].sort((a, b) => (a.group ?? GROUPS) - (b.group ?? GROUPS));
}

/** A group's place in the address: its number, or "none" for the runs without one. */
export function groupSegment(group: number | null): string {
  return group === null ? "none" : String(group);
}

/** The tags the runs use, in alphabetical order, for the tag filter. */
export function tagsInUse(runs: readonly ResearchRun[]): string[] {
  return [...new Set(runs.flatMap((run) => run.reading.tags))].sort();
}
