// Research runs stored in the private bucket for the owner's Automata view.
// The CLI (gallery/research.ts) uploads exported run folders; admin.ts serves them to the owner
// and publishes selected runs via showStoredRuns.
//
//   private bucket  research/manifest.json                     run index, written last
//                   research/runs/<id>/material.json           exported format-4 automaton file
//                   research/runs/<id>/still-0200.png, ...     stills listed by the index

import { readFigureMaterial, type FigureMaterialFile } from "../../app/src/materials/material-file.ts";
import {
  definitionRule, entryIdOfRun, placeOfRun, promotedRunEntries, readResearchManifest, RESEARCH_MANIFEST_BYTES, RESEARCH_MANIFEST_KEY,
  researchRunKey, stillName, type ResearchManifest, type ResearchRun,
} from "../../app/src/features/research/research-runs.ts";
import type { GalleryPlace } from "../../app/src/features/gallery/gallery-place.ts";
import { materialKey, type MaterialEntry } from "../../app/src/features/gallery/material-index.ts";
import {
  checkedMaterial, hiddenMaterials, MATERIAL_DICTIONARIES, MATERIAL_LIMITS, PROJECT_CREDIT, publishMaterials, readMaterials,
  replaceMaterialFiles, setGalleryPlaces, type MaterialToPublish, type ReplacedMaterialFiles,
} from "./material-review.ts";
import { ConflictError, isPng, requiredObject, sha256Hex, type Bucket } from "./storage.ts";

/** Uploads in flight at once: the REST bucket answers each put in about a quarter of a second. */
const CONCURRENT_UPLOADS = 8;

/** The run index as text: its size, then readResearchManifest, then the basis collection. */
export function checkedResearchManifest(text: string): ResearchManifest {
  if (new TextEncoder().encode(text).length > RESEARCH_MANIFEST_BYTES) throw new Error(`the research manifest is larger than ${RESEARCH_MANIFEST_BYTES} bytes`);
  const manifest = readResearchManifest(JSON.parse(text));
  if (!MATERIAL_DICTIONARIES.includes(manifest.dictionaryId)) throw new Error(`the research manifest belongs to another basis collection: ${manifest.dictionaryId}`);
  return manifest;
}

/** The stored run index, or null before the first publish. */
export async function storedResearchManifest(bucket: Bucket): Promise<ResearchManifest | null> {
  const stored = await bucket.get(RESEARCH_MANIFEST_KEY);
  return stored === null ? null : readResearchManifest(JSON.parse(await stored.text()));
}

/** One run's exported files: its format-4 file and its stills by tick. */
export interface ResearchRunFiles {
  material: Uint8Array<ArrayBuffer>;
  stills: Map<number, Uint8Array<ArrayBuffer>>;
}

/**
 * Validate a run's files against its manifest row: SHA-256 digest, format-4 loader,
 * id, basis group, submission size limit, and PNG header for every listed still.
 */
export async function researchRunProblems(run: ResearchRun, files: ResearchRunFiles): Promise<string[]> {
  const problems: string[] = [];
  if (await sha256Hex(files.material) !== run.materialSha256) problems.push("material.json does not have the SHA-256 the index gives");
  if (files.material.length > MATERIAL_LIMITS.materialBytes) problems.push(`material.json is larger than ${MATERIAL_LIMITS.materialBytes} bytes, more than a promotion accepts`);
  try {
    const { file } = readFigureMaterial(JSON.parse(new TextDecoder().decode(files.material)));
    if (file.id !== run.id) problems.push(`material.json has the id ${file.id}, not the run's id`);
    if (run.group !== null && file.block !== run.group) problems.push(`material.json trains basis group ${file.block}, not ${run.group}`);
  } catch (error) {
    problems.push(`material.json is not a valid format-4 file: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const tick of run.stills) {
    const still = files.stills.get(tick);
    if (still === undefined || !isPng(still)) problems.push(`${stillName(tick)} is missing or not a PNG`);
  }
  return problems.map((problem) => `run ${run.id}: ${problem}`);
}

/** The listed runs whose file has another SHA-256 than the stored index gives. */
export function changedRuns(stored: ResearchManifest | null, next: ResearchManifest): ResearchRun[] {
  const written = new Map((stored?.runs ?? []).map((run) => [run.id, run.materialSha256]));
  return next.runs.filter((run) => written.has(run.id) && written.get(run.id) !== run.materialSha256);
}

/**
 * Return runs missing from the stored manifest. Rejects runs whose SHA-256 changed unless
 * reread is true (in which case rereadProblems verifies only reading and preview changed).
 */
export function runsToWrite(stored: ResearchManifest | null, next: ResearchManifest, reread = false): ResearchRun[] {
  const changed = changedRuns(stored, next);
  if (changed.length > 0 && !reread) {
    throw new ConflictError(`these runs changed their file; give each a new id, or publish with --reread when only their reading was taken again: ${changed.map((run) => run.id).join(", ")}`);
  }
  const written = new Set((stored?.runs ?? []).map((run) => run.id));
  return next.runs.filter((run) => !written.has(run.id));
}

/** Fields that a re-reading is allowed to replace on an existing run file. */
const REREAD_FIELDS: readonly string[] = ["reading", "preview"];

/** Deep structural JSON equality (key-order independent for objects). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>];
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

/**
 * Return why a re-read file cannot replace the stored run file, or null when only
 * reading and preview fields differ (meaning the rule and training metadata are unchanged).
 */
export function rereadProblem(storedText: string, nextText: string): string | null {
  const stored = JSON.parse(storedText) as Record<string, unknown>;
  const next = JSON.parse(nextText) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(stored), ...Object.keys(next)])];
  const differing = fields.filter((field) => !REREAD_FIELDS.includes(field) && !sameJson(stored[field], next[field]));
  return differing.length === 0 ? null : `its file differs in ${differing.join(", ")}, more than its reading and preview`;
}

/** Run rereadProblem against the bucket copy for every changed run. */
export async function rereadProblems(bucket: Bucket, runs: readonly ResearchRun[], filesOf: (run: ResearchRun) => ResearchRunFiles): Promise<string[]> {
  const problems: string[] = [];
  for (const run of runs) {
    const stored = await (await requiredObject(bucket, researchRunKey(run.id, "material.json"))).text();
    const problem = rereadProblem(stored, new TextDecoder().decode(filesOf(run).material));
    if (problem !== null) problems.push(`run ${run.id}: ${problem}`);
  }
  return problems;
}

/** Commit the manifest after every private file and published rereading is in place. A retry
 * compares against the previous manifest and can finish a failed public write.
 */
export async function writeResearch(
  submissions: Bucket,
  library: Bucket,
  manifestText: string,
  runs: { added: ResearchRun[]; reread: ResearchRun[] },
  filesOf: (run: ResearchRun) => ResearchRunFiles,
): Promise<ReplacedMaterialFiles | null> {
  const queue = [...runs.added, ...runs.reread];
  const upload = async () => {
    for (let run = queue.shift(); run !== undefined; run = queue.shift()) {
      const files = filesOf(run);
      await submissions.put(researchRunKey(run.id, "material.json"), files.material, { httpMetadata: { contentType: "application/json" } });
      for (const tick of run.stills) {
        await submissions.put(researchRunKey(run.id, stillName(tick)), files.stills.get(tick)!, { httpMetadata: { contentType: "image/png" } });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT_UPLOADS }, upload));
  const replaced = runs.reread.length ? await republishRereadRuns(submissions, library, runs.reread) : null;
  await submissions.put(RESEARCH_MANIFEST_KEY, manifestText, { httpMetadata: { contentType: "application/json" } });
  return replaced;
}

/**
 * Publish stored research runs onto the Automata page and return the resulting index entries.
 * Rejects unknown run ids before writing anything.
 */
export async function showStoredRuns(submissions: Bucket, library: Bucket, ids: readonly string[], now: Date): Promise<{ result: ShownRuns; entries: MaterialEntry[] }> {
  const manifest = await storedResearchManifest(submissions);
  const rows = new Map((manifest?.runs ?? []).map((run) => [run.id, run]));
  const unknown = ids.filter((id) => !rows.has(id));
  if (unknown.length > 0) throw new ConflictError(`no research run ${unknown.join(", ")}`);
  const runs = ids.map((id) => rows.get(id)!);
  const result = await showResearchRuns(submissions, library, runs, now, true);
  const touched = new Set([...result.published, ...result.placed]);
  const entries = (await readMaterials(library)).entries.filter((entry) => touched.has(entry.id));
  return { result, entries };
}

/**
 * Propagate re-read run files from the private bucket to matching shown or hidden automata on the
 * public site. Runs not published on the site are ignored.
 */
async function republishRereadRuns(submissions: Bucket, library: Bucket, runs: readonly ResearchRun[]): Promise<ReplacedMaterialFiles> {
  const entries = [...(await readMaterials(library)).entries, ...(await hiddenMaterials(submissions))];
  // A re-read keeps the run's rule (rereadProblem), so an earlier promotion still matches the new file.
  const promoted = await promotedRuns(submissions, library, runs, entries);
  const files = new Map<string, FigureMaterialFile>();
  for (const run of runs) {
    const id = promoted.get(run.id) ?? entryIdOfRun(run);
    const checked = checkedMaterial(await (await requiredObject(submissions, researchRunKey(run.id, "material.json"))).text());
    if ("error" in checked) throw new ConflictError(`${run.id}: ${checked.error}`);
    files.set(id, checked.file);
  }
  return replaceMaterialFiles(submissions, library, files);
}

/** Map research run ids to previously promoted automaton entry ids by comparing stored rules. */
function promotedRuns(submissions: Bucket, library: Bucket, runs: readonly ResearchRun[], entries: readonly MaterialEntry[]): Promise<Map<string, string>> {
  const ruleAt = async (bucket: Bucket, key: string) => {
    const stored = await bucket.get(key);
    return stored === null ? null : definitionRule(JSON.parse(await stored.text()));
  };
  return promotedRunEntries(
    runs, entries,
    (id) => ruleAt(submissions, researchRunKey(id, "material.json")),
    (id) => ruleAt(library, materialKey(id, "material.json")),
  );
}

/** Summary of entry ids handled by showResearchRuns. */
export interface ShownRuns {
  /** Runs published as new automata. */
  published: string[];
  /** Already-shown automata whose grid place was updated without replacing their files. */
  placed: string[];
  /** Runs left hidden because the owner previously hid them. */
  keptHidden: string[];
  /** Runs without a valid gallery grid place; skipped. */
  withoutPlace: string[];
}

/**
 * Publish research runs onto the Automata page in one index write.
 * New rules are published under the project credit with their grid place and review mark.
 * Already-shown rules only update their grid place. Hidden entries remain hidden.
 * When write is false, return the plan without modifying storage.
 */
export async function showResearchRuns(
  submissions: Bucket, library: Bucket, runs: readonly ResearchRun[], now: Date, write: boolean,
): Promise<ShownRuns> {
  const entries = (await readMaterials(library)).entries;
  const hiddenRecords = await hiddenMaterials(submissions);
  const shown = new Set(entries.map((entry) => entry.id));
  const hidden = new Set(hiddenRecords.map((entry) => entry.id));
  const promoted = await promotedRuns(submissions, library, runs, [...entries, ...hiddenRecords]);
  const result: ShownRuns = { published: [], placed: [], keptHidden: [], withoutPlace: [] };
  const toPublish: MaterialToPublish[] = [];
  const places = new Map<string, GalleryPlace>();
  for (const run of runs) {
    // Reuse a previously promoted entry matched by rule before falling back to the run's own entry id.
    const id = promoted.get(run.id) ?? entryIdOfRun(run);
    const place = placeOfRun(run);
    if (place === null) {
      result.withoutPlace.push(run.id);
    } else if (hidden.has(id)) {
      result.keptHidden.push(id);
    } else if (shown.has(id)) {
      places.set(id, place);
      result.placed.push(id);
    } else {
      const checked = checkedMaterial(await (await requiredObject(submissions, researchRunKey(run.id, "material.json"))).text());
      if ("error" in checked) throw new ConflictError(`${run.id}: ${checked.error}`);
      toPublish.push({
        id, file: checked.file, label: { title: "", credit: PROJECT_CREDIT }, hidden: false, featured: false,
        gallery: place, featuredInBlock: run.review.featured,
      });
      result.published.push(id);
    }
  }
  if (write) {
    if (toPublish.length > 0) await publishMaterials(submissions, library, toPublish, now);
    await setGalleryPlaces(library, places);
  }
  return result;
}
