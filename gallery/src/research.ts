// The research runs in the private bucket, for the owner's research page
// (app/src/features/research/). The publish command (gallery/research.ts) writes them from the
// research repository's export; the owner page reads them through admin.ts and promotes a run to a
// pending material, which Approve publishes like any other. Nothing here reaches the public bucket.
//
//   private bucket  research/manifest.json                     the run index, written last
//                   research/runs/<id>/material.json           the run's format-4 file, as exported
//                   research/runs/<id>/still-0200.png, ...     its stills, one per tick the index lists

import { readFigureMaterial } from "../../app/src/materials/material-file.ts";
import {
  entryIdOfRun, placeOfRun, readResearchManifest, RESEARCH_MANIFEST_BYTES, RESEARCH_MANIFEST_KEY, researchRunKey, stillName,
  type ResearchManifest, type ResearchRun,
} from "../../app/src/features/research/research-runs.ts";
import { submissionLabelProblem } from "../../app/src/features/gallery/submission-label.ts";
import type { GalleryPlace } from "../../app/src/features/gallery/gallery-place.ts";
import type { MaterialEntry } from "../../app/src/features/gallery/material-index.ts";
import {
  checkedMaterial, hiddenMaterialKey, MATERIAL_DICTIONARIES, MATERIAL_LIMITS, materialPoster, PROJECT_CREDIT, publishMaterials, readMaterials,
  setGalleryPlaces, storeMaterialSubmission, type MaterialSubmissionMetadata, type MaterialToPublish,
} from "./material-review.ts";
import { isPng, listKeys, requiredObject, submissionId, type Bucket } from "./storage.ts";

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

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * What is wrong with a run's files, measured against its row in the index: the file's SHA-256, the
 * app's loader, its id and basis group, the size a promotion accepts, and a PNG for every still.
 * Empty when nothing is.
 */
export async function researchRunProblems(run: ResearchRun, files: ResearchRunFiles): Promise<string[]> {
  const problems: string[] = [];
  if (await sha256(files.material) !== run.materialSha256) problems.push("material.json does not have the SHA-256 the index gives");
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

/**
 * The runs a publish writes: those the stored index does not list yet. A run's files never change
 * once written, so a listed run whose file has another SHA-256 is refused; a retrained run takes a
 * new id. Changed readings and outcomes need no upload: the new index carries them.
 */
export function runsToWrite(stored: ResearchManifest | null, next: ResearchManifest): ResearchRun[] {
  const written = new Map((stored?.runs ?? []).map((run) => [run.id, run.materialSha256]));
  const changed = next.runs.filter((run) => written.has(run.id) && written.get(run.id) !== run.materialSha256);
  if (changed.length > 0) throw new Error(`these runs changed their file; give each a new id: ${changed.map((run) => run.id).join(", ")}`);
  return next.runs.filter((run) => !written.has(run.id));
}

/** Write the runs' files, then the index, so a stored index never names a run without its files. */
export async function writeResearch(bucket: Bucket, manifestText: string, runs: ResearchRun[], filesOf: (run: ResearchRun) => ResearchRunFiles): Promise<void> {
  const queue = [...runs];
  const upload = async () => {
    for (let run = queue.shift(); run !== undefined; run = queue.shift()) {
      const files = filesOf(run);
      await bucket.put(researchRunKey(run.id, "material.json"), files.material, { httpMetadata: { contentType: "application/json" } });
      for (const tick of run.stills) {
        await bucket.put(researchRunKey(run.id, stillName(tick)), files.stills.get(tick)!, { httpMetadata: { contentType: "image/png" } });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT_UPLOADS }, upload));
  await bucket.put(RESEARCH_MANIFEST_KEY, manifestText, { httpMetadata: { contentType: "application/json" } });
}

/**
 * Promote a run to a pending material under a new submission id: its file is checked with the app's
 * loader as a visitor's would be, and stored with the owner's title and the project's credit. It
 * becomes public only when the owner approves it (approveMaterial).
 */
export async function promoteResearchRun(submissions: Bucket, runId: string, title: string, now: Date, random: Uint8Array): Promise<MaterialSubmissionMetadata> {
  const trimmed = title.trim();
  const problem = submissionLabelProblem(trimmed, MATERIAL_LIMITS.titleCharacters);
  if (trimmed === "" || problem !== null) throw new Error(`the title must be 1 to ${MATERIAL_LIMITS.titleCharacters} characters without control characters`);
  const text = await (await requiredObject(submissions, researchRunKey(runId, "material.json"))).text();
  const checked = checkedMaterial(text);
  if ("error" in checked) throw new Error(`${runId}: ${checked.error}`);
  const submission = { file: checked.file, text: JSON.stringify(checked.file), poster: materialPoster(checked.file), title: trimmed, credit: PROJECT_CREDIT };
  return storeMaterialSubmission(submissions, submissionId(now, random), submission, now);
}

/**
 * Show the runs of these ids, for the owner's view: their rows come from the stored run index, and
 * the answer adds the entries as the published index now lists them, so the page can show each in
 * its place at once. An id the index does not list is refused before anything is written.
 */
export async function showStoredRuns(submissions: Bucket, library: Bucket, ids: readonly string[], now: Date): Promise<{ result: ShownRuns; entries: MaterialEntry[] }> {
  const manifest = await storedResearchManifest(submissions);
  const rows = new Map((manifest?.runs ?? []).map((run) => [run.id, run]));
  const unknown = ids.filter((id) => !rows.has(id));
  if (unknown.length > 0) throw new Error(`no research run ${unknown.join(", ")}`);
  const runs = ids.map((id) => rows.get(id)!);
  const result = await showResearchRuns(submissions, library, runs, now, true);
  const touched = new Set([...result.published, ...result.placed]);
  const entries = (await readMaterials(library)).entries.filter((entry) => touched.has(entry.id));
  return { result, entries };
}

/** What showResearchRuns did, or in a dry run would do, by entry id. */
export interface ShownRuns {
  /** Runs published as new automata: their file and poster, and an index entry. */
  published: string[];
  /** Runs whose rule was a shown automaton already: its entry took the run's place in the grid, and nothing else changed. */
  placed: string[];
  /** Runs left as the owner hid them: a hidden automaton stays hidden. */
  keptHidden: string[];
  /** Runs the grid has no place for; they are not published. */
  withoutPlace: string[];
}

/**
 * Show research runs on the Automata page. A run whose rule is not on the site becomes a published
 * automaton under the project's credit and without a title, with its place in its basis group's
 * grid and the review's mark within the group; its file is checked with the app's loader as any
 * submission's is. A run whose rule is a shown automaton already only gives that entry its place: a
 * published file never changes. One index write for all of them. With `write` false nothing is
 * written, and the answer is what would be.
 */
export async function showResearchRuns(
  submissions: Bucket, library: Bucket, runs: readonly ResearchRun[], now: Date, write: boolean,
): Promise<ShownRuns> {
  const shown = new Set((await readMaterials(library)).entries.map((entry) => entry.id));
  const hidden = new Set(await listKeys(submissions, "hidden/materials/"));
  const result: ShownRuns = { published: [], placed: [], keptHidden: [], withoutPlace: [] };
  const toPublish: MaterialToPublish[] = [];
  const places = new Map<string, GalleryPlace>();
  for (const run of runs) {
    const id = entryIdOfRun(run);
    const place = placeOfRun(run);
    if (place === null) {
      result.withoutPlace.push(run.id);
    } else if (hidden.has(hiddenMaterialKey(id))) {
      result.keptHidden.push(id);
    } else if (shown.has(id)) {
      places.set(id, place);
      result.placed.push(id);
    } else {
      const checked = checkedMaterial(await (await requiredObject(submissions, researchRunKey(run.id, "material.json"))).text());
      if ("error" in checked) throw new Error(`${run.id}: ${checked.error}`);
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
