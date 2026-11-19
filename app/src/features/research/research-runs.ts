// The research runs that the owner's Automata page (/admin/automata) places in the grid: the run
// index that the research repository exports, research/manifest.json in the private bucket, read
// and checked here, and where a run belongs on the page. The gallery Worker and its publish command
// (gallery/research.ts) check the same file with readResearchManifest. This module has no browser
// or React imports.

import { isGalleryMethod, isGalleryStart, type GalleryMethod, type GalleryPlace, type GalleryStart } from "../gallery/gallery-place.ts";
import type { MaterialEntry } from "../gallery/material-index.ts";

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
  | ({ kind: "guided" } & GuideSettings)
  | { kind: "plain-margin" }
  | { kind: "other" };

/**
 * A guided run's guide, in the trainer's names. Each is null when the run does not use it: the
 * early runs hold the guide for a fixed number of updates (releaseAtUpdate) instead of releasing it
 * by releaseFraction, and the first of them cap the guide's weight (weightCap) instead of a ratio.
 */
export interface GuideSettings {
  ratio: number | null;
  weightCap: number | null;
  releaseFraction: number | null;
  releaseAtUpdate: number | null;
  releaseFloor: number | null;
  /** Whether the guide comes back after its release. */
  reEngage: boolean | null;
  /**
   * When it comes back: its 25-update mean loss rises above this share of its first value (it
   * switches off again below the release fraction).
   */
  reEngageAt: number | null;
  zFloor: number | null;
  /** The DINO MLP units the guide acts on, the natural circuit after the z floor, such as "73 DINO units"; empty when unstated. */
  units: string;
}

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
  /**
   * The owner's review of the run, as the export records it: whether it goes on the site, and whether
   * it is featured within its basis group (which needs `site`). Absent in an older export: neither.
   */
  review: { site: boolean; featured: boolean };
  /**
   * The run's place on the Automata page, and whether the public gallery shows it before the owner has
   * chosen (the export's rule; its README, "Gallery fields"). Null in an export from before the fields.
   */
  gallery: RunGallery | null;
  /** Why the run was made when not for a study's question: to tune the trainer's settings, or to test it. Null otherwise. */
  role: RunRole | null;
  /** The published automata whose rule is this run's, by entry id; the run is on the site as each of them. */
  siteMaterials: string[];
  /** SHA-256 of research/runs/<id>/material.json, the run's format-4 file. */
  materialSha256: string;
  /** The ticks with a still under research/runs/<id>/ (stillName), ascending. */
  stills: number[];
}

/** A run's gallery fields, as the export writes them. */
export interface RunGallery {
  /** Null for a start the grid has no row for: the all-zero start of the first runs, and a start from a picture. */
  start: GalleryStart | null;
  method: GalleryMethod;
  /** "group" when the request is the basis group as a whole; "other" for a level, a region, a unit, two sets and the like. */
  target: "group" | "other";
  shown: boolean;
}

export type RunRole = "settings-sweep" | "smoke-test";

export interface ResearchManifest {
  format: 1;
  generatedAt: string;
  researchCommit: string;
  dictionaryId: string;
  studies: ResearchStudy[];
  runs: ResearchRun[];
}

/**
 * The entry a run is on the Automata page as: the published automaton that already holds its rule
 * (`siteMaterials`), else an entry under the run's own id. So a rule that is both a published automaton
 * and a research run appears once, at the address it always had.
 */
export function entryIdOfRun(run: Pick<ResearchRun, "id" | "siteMaterials">): string {
  return run.siteMaterials[0] ?? run.id;
}

/** The fields that make two definitions one automaton: the rule's layout and its float32 weights. */
export interface DefinitionRule {
  layout: string;
  values: string;
}

/** A definition's rule as its JSON holds it, or null when the JSON has none. */
export function definitionRule(value: unknown): DefinitionRule | null {
  const rule = (value as { rule?: { layout?: unknown; values?: unknown } } | null)?.rule;
  return typeof rule?.layout === "string" && typeof rule.values === "string" ? { layout: rule.layout, values: rule.values } : null;
}

/** Reads one definition's rule by id: a run's private file, or a shown or hidden automaton's published one. Null when it is not there. */
export type RuleReader = (id: string) => Promise<DefinitionRule | null>;

/**
 * The runs that an earlier promotion published under a submission's id, as run id to entry id. An
 * entry whose file names a run's id (its materialId) is only a candidate: the submitter chose that id.
 * It holds the run only when its published rule is the run's own rule, which a visitor cannot know
 * for a run that was never shown. A run whose own entry (entryIdOfRun) is among the entries needs no
 * promotion, and nothing is read for it. The Worker (gallery/src/research.ts) and the owner's page
 * (research-api.ts) answer with this one rule, each with its own readers.
 */
export async function promotedRunEntries(
  runs: readonly ResearchRun[],
  entries: readonly Pick<MaterialEntry, "id" | "materialId">[],
  readRunRule: RuleReader,
  readEntryRule: RuleReader,
): Promise<Map<string, string>> {
  const entryIds = new Set(entries.map((entry) => entry.id));
  const claimants = new Map<string, string[]>();
  for (const entry of entries) claimants.set(entry.materialId, [...(claimants.get(entry.materialId) ?? []), entry.id]);
  const promoted = new Map<string, string>();
  for (const run of runs) {
    const candidates = claimants.get(run.id) ?? [];
    if (entryIds.has(entryIdOfRun(run)) || candidates.length === 0) continue;
    const runRule = await readRunRule(run.id);
    if (runRule === null) continue;
    for (const id of candidates) {
      const rule = await readEntryRule(id);
      if (rule !== null && rule.layout === runRule.layout && rule.values === runRule.values) {
        promoted.set(run.id, id);
        break;
      }
    }
  }
  return promoted;
}

/** A run's place in its basis group's grid, or null for a run the grid has no place for (an older export, or a start outside the grid). */
export function placeOfRun(run: Pick<ResearchRun, "gallery">): GalleryPlace | null {
  if (run.gallery === null || run.gallery.start === null) return null;
  return { start: run.gallery.start, method: run.gallery.method };
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
  const optionalNumber = (name: string) => nullable(loss[name] ?? null, (present) => finite(present, `${where}.${name}`));
  return {
    kind: "guided",
    ratio: optionalNumber("ratio"),
    weightCap: optionalNumber("weightCap"),
    releaseFraction: optionalNumber("releaseFraction"),
    releaseAtUpdate: nullable(loss.releaseAtUpdate ?? null, (present) => count(present, `${where}.releaseAtUpdate`)),
    releaseFloor: optionalNumber("releaseFloor"),
    reEngage: nullable(loss.reEngage ?? null, (present) => flag(present, `${where}.reEngage`)),
    reEngageAt: optionalNumber("reEngageAt"),
    zFloor: optionalNumber("zFloor"),
    units: text(loss.units ?? "", `${where}.units`),
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
    review: run.review === undefined ? { site: false, featured: false } : readReview(run.review, `${where}.review`),
    gallery: run.gallery === undefined ? null : readGallery(run.gallery, `${where}.gallery`),
    role: readRole(run.role, `${where}.role`),
    siteMaterials: readSiteMaterials(run.siteMaterials, `${where}.siteMaterials`),
    materialSha256,
    stills,
  };
}

function readReview(value: unknown, where: string): ResearchRun["review"] {
  const review = record(value, where);
  const site = flag(review.site, `${where}.site`);
  const featured = flag(review.featured, `${where}.featured`);
  if (featured && !site) fail(`${where}.featured`, "a featured run must be on the site list");
  return { site, featured };
}

function readGallery(value: unknown, where: string): RunGallery {
  const gallery = record(value, where);
  if (gallery.start !== null && !isGalleryStart(gallery.start)) fail(`${where}.start`, "must be a start the gallery names, or null");
  if (!isGalleryMethod(gallery.method)) fail(`${where}.method`, "must be a method the gallery names");
  if (gallery.target !== "group" && gallery.target !== "other") fail(`${where}.target`, 'must be "group" or "other"');
  return { start: gallery.start, method: gallery.method, target: gallery.target, shown: flag(gallery.shown, `${where}.shown`) };
}

function readRole(value: unknown, where: string): RunRole | null {
  if (value === undefined || value === null) return null;
  if (value !== "settings-sweep" && value !== "smoke-test") fail(where, 'must be "settings-sweep" or "smoke-test"');
  return value;
}

function readSiteMaterials(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(where, "must be a list of entry ids");
  return value.map((id, index) => text(id, `${where}[${index}]`, 96));
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
