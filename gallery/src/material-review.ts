// Materials in the gallery: a submitted format-4 material file, pending in the private bucket
// until the owner approves it from the terminal or the owner page; approval publishes the file
// and its poster and rewrites published/materials.json. Every entry comes from a file
// checked by the app's own loader; shader source is never stored.
//
//   private bucket  pending/<id>/material.json, poster.png, meta.json        (meta.json last)
//                   hidden/materials/<id>.json                               (a hidden entry)
//   public bucket   gallery/materials/<id>/versions/<revision>/material.json, poster.png
//                   gallery/materials/<id>/material.json, poster.png         (current copies for older clients)
//                   published/materials.json                                 (shown entries only)

import { canonicalFigureFile, readFigureMaterial, readingPictureSide, type FigureMaterialFile } from "../../app/src/materials/material-file.ts";
import {
  EMPTY_MATERIAL_INDEX, MATERIAL_INDEX_KEY, isMaterialEntryId, materialEntry, materialKey, placeOf, readMaterialIndex,
  versionedMaterialKey, withMaterialEntry, withoutMaterialEntry, type MaterialEntry, type MaterialIndex,
} from "../../app/src/features/gallery/material-index.ts";
import { samePlace, type GalleryPlace } from "../../app/src/features/gallery/gallery-place.ts";
import { MATERIAL_SUBMISSION_LIMITS } from "../../app/src/features/gallery/submission-label.ts";
import { CACHE_IMMUTABLE, CACHE_INDEX, ConflictError, isPng, listKeys, requiredObject, sha256Hex, type Bucket } from "./storage.ts";
import { previewKeys } from "./link-preview.ts";

/** The dictionary of the current release; a material of another dictionary reads other codes. */
export const MATERIAL_DICTIONARIES: readonly string[] = ["monet-dtd-seed9-20261004-pass-003"];
export const MATERIAL_LIMITS = { materialBytes: 256 * 1024, ...MATERIAL_SUBMISSION_LIMITS } as const;
/** The project's own entries (seeds and promoted research runs) are attributed to it, not to a visitor. */
export const PROJECT_CREDIT = "DinoDreamer project";
const PENDING_FILES = ["material.json", "poster.png", "meta.json"] as const;
type PendingFile = (typeof PENDING_FILES)[number];

/** pending/<id>/meta.json of a material, written after the file and the poster. */
export interface MaterialSubmissionMetadata {
  kind: "material";
  id: string;
  title: string;
  credit: string;
  submittedAt: string;
  block: number;
  materialId: string;
  /** A research run promoted from the owner page: its run id, and whether the owner's review featured it in its basis group. */
  researchRunId?: string;
  featuredInBlock?: boolean;
}
/** A checked submission: the canonical file and its text, which is what the bucket stores. */
export interface MaterialSubmission { file: FigureMaterialFile; text: string; poster: Uint8Array; title: string; credit: string }
/** hidden/materials/<id>.json: the index entry as it was shown, and when it was hidden. */
export interface HiddenMaterial extends MaterialEntry { hiddenAt: string }

export function pendingMaterialKey(id: string, file: PendingFile): string {
  return `pending/${id}/${file}`;
}
export function hiddenMaterialKey(id: string): string {
  return `hidden/materials/${id}.json`;
}

/** The embedded preview as PNG bytes, checked to show the reading's picture: its grid at the file's pixels per cell. */
export function materialPoster(file: FigureMaterialFile): Uint8Array {
  const binary = atob(file.preview.slice("data:image/png;base64,".length));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!isPng(bytes)) throw new Error("the automaton definition's preview is not a PNG");
  const header = new DataView(bytes.buffer, 16, 8);
  const side = readingPictureSide(file);
  if (header.getUint32(0) !== side || header.getUint32(4) !== side) {
    throw new Error(`the automaton definition's preview must be ${side} × ${side} pixels, the image size of its measurement`);
  }
  return bytes;
}

/**
 * An untrusted material file's text: the app's loader, the current dictionary and the poster. The
 * result is the canonical file (canonicalFigureFile): only the fields format 4 defines are kept, so
 * an added property such as a shader string is never stored or published.
 */
export function checkedMaterial(text: string): { file: FigureMaterialFile } | { error: string } {
  if (new TextEncoder().encode(text).length > MATERIAL_LIMITS.materialBytes) return { error: "automaton definition is larger than 256 KB" };
  let file: FigureMaterialFile;
  try {
    file = canonicalFigureFile(readFigureMaterial(JSON.parse(text)).file);
    if (!MATERIAL_DICTIONARIES.includes(file.dictionaryId)) return { error: `automaton definition belongs to another basis collection: ${file.dictionaryId.slice(0, 64)}` };
    materialPoster(file);
  } catch (error) {
    return { error: `automaton definition is not a valid format-4 file: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { file };
}

/** Write the pending objects; meta.json is last, so a listed meta.json means a complete submission. */
export async function storeMaterialSubmission(bucket: Bucket, id: string, submission: MaterialSubmission, now: Date): Promise<MaterialSubmissionMetadata> {
  const metadata: MaterialSubmissionMetadata = {
    kind: "material", id, title: submission.title, credit: submission.credit, submittedAt: now.toISOString(),
    block: submission.file.block, materialId: submission.file.id,
  };
  await bucket.put(pendingMaterialKey(id, "material.json"), submission.text, { httpMetadata: { contentType: "application/json" } });
  await bucket.put(pendingMaterialKey(id, "poster.png"), submission.poster, { httpMetadata: { contentType: "image/png" } });
  await bucket.put(pendingMaterialKey(id, "meta.json"), JSON.stringify(metadata, null, 2), { httpMetadata: { contentType: "application/json" } });
  return metadata;
}

export async function readMaterials(library: Bucket): Promise<MaterialIndex> {
  const stored = await library.get(MATERIAL_INDEX_KEY);
  return stored === null ? EMPTY_MATERIAL_INDEX : readMaterialIndex(JSON.parse(await stored.text()));
}

async function writeMaterials(library: Bucket, index: MaterialIndex): Promise<void> {
  await library.put(MATERIAL_INDEX_KEY, JSON.stringify(index, null, 2), {
    httpMetadata: { contentType: "application/json", cacheControl: CACHE_INDEX },
  });
}

function checkedEntryId(id: string): string {
  if (!isMaterialEntryId(id)) throw new ConflictError(`"${id}" is not an entry id for an automaton definition`);
  return id;
}

/**
 * Publish the file and poster before adding the revision to the index.
 * Approval and the project's seed both come here. A reseed keeps the owner's marks.
 */
export async function publishMaterial(library: Bucket, id: string, given: FigureMaterialFile, label: { title: string; credit: string }, now: Date): Promise<MaterialEntry> {
  const published = await putMaterialObjects(library, id, given, label, now);
  const index = await readMaterials(library);
  const existing = index.entries.find((shown) => shown.id === id);
  const entry = existing ? entryWithFile(existing, published) : published;
  await writeMaterials(library, withMaterialEntry(index, entry));
  return entry;
}

/** Write both immutable versioned objects. The digest covers the PNG embedded in the definition. */
async function putMaterialVersion(library: Bucket, id: string, definition: Uint8Array<ArrayBuffer>, poster: Uint8Array): Promise<string> {
  const revision = await sha256Hex(definition);
  await library.put(versionedMaterialKey(id, revision, "material.json"), definition, {
    httpMetadata: { contentType: "application/json", cacheControl: CACHE_IMMUTABLE },
  });
  await library.put(versionedMaterialKey(id, revision, "poster.png"), poster, {
    httpMetadata: { contentType: "image/png", cacheControl: CACHE_IMMUTABLE },
  });
  return revision;
}

/** Keep the stable objects for existing readers. Publish the revision only after both pairs are complete. */
async function putMaterialObjects(library: Bucket, id: string, given: FigureMaterialFile, label: { title: string; credit: string }, now: Date): Promise<MaterialEntry> {
  const file = canonicalFigureFile(given);
  const entry = materialEntry(checkedEntryId(id), file, label, now.toISOString());
  const poster = materialPoster(file);
  const definition = new TextEncoder().encode(JSON.stringify(file));
  const fileRevision = await putMaterialVersion(library, id, definition, poster);
  await library.put(materialKey(id, "material.json"), definition, { httpMetadata: { contentType: "application/json", cacheControl: CACHE_INDEX } });
  await library.put(materialKey(id, "poster.png"), poster, { httpMetadata: { contentType: "image/png", cacheControl: CACHE_INDEX } });
  return { ...entry, fileRevision };
}

/**
 * One material for publishMaterials; `hidden` publishes its objects and keeps it out of the index, and
 * `featured` is the owner's mark, kept in the hidden record too. A research run also brings its place
 * in its basis group's grid and the review's mark within the group (research.ts, showResearchRuns).
 */
export interface MaterialToPublish {
  id: string;
  file: FigureMaterialFile;
  label: { title: string; credit: string };
  hidden: boolean;
  featured: boolean;
  gallery?: GalleryPlace;
  featuredInBlock?: boolean;
}

/**
 * Publish many materials in one pass: every file and poster, then the index written once, with a hidden
 * record for each hidden one (objects kept, out of the index, as hideMaterial leaves it). The production
 * seed comes here, so 172 materials cost one index write, not 172.
 */
export async function publishMaterials(submissions: Bucket, library: Bucket, materials: MaterialToPublish[], now: Date): Promise<{ shown: number; hidden: number }> {
  let index = await readMaterials(library);
  const hiddenBefore = new Set(await listKeys(submissions, "hidden/materials/"));
  for (const material of materials) {
    const entry: MaterialEntry = {
      ...(await putMaterialObjects(library, material.id, material.file, material.label, now)),
      featured: material.featured,
      ...(material.featuredInBlock === undefined ? {} : { featuredInBlock: material.featuredInBlock || material.featured }),
      ...(material.gallery === undefined ? {} : { gallery: material.gallery }),
    };
    if (material.hidden) {
      const record: HiddenMaterial = { ...entry, hiddenAt: now.toISOString() };
      await submissions.put(hiddenMaterialKey(material.id), JSON.stringify(record, null, 2), { httpMetadata: { contentType: "application/json" } });
      index = withoutMaterialEntry(index, material.id);
    } else {
      index = withMaterialEntry(index, entry);
    }
  }
  await writeMaterials(library, index);
  // Keep each recovery record until its entry is published, as restoreMaterial does.
  for (const material of materials) {
    if (!material.hidden && hiddenBefore.has(hiddenMaterialKey(material.id))) await submissions.delete(hiddenMaterialKey(material.id));
  }
  const hidden = materials.filter((material) => material.hidden).length;
  return { shown: materials.length - hidden, hidden };
}

/** Summary of entry ids processed by replaceMaterialFiles. */
export interface ReplacedMaterialFiles {
  /** Shown automata whose file, poster, and index entry were replaced. */
  shown: string[];
  /** Hidden automata whose file, poster, and recovery record were replaced. */
  hidden: string[];
  /** Entry ids that are neither shown nor hidden; left untouched. */
  absent: string[];
}

/** Update file-derived metadata on an entry while preserving its label, owner marks, and gallery place. */
function entryWithFile<Entry extends MaterialEntry>(entry: Entry, fromFile: MaterialEntry): Entry {
  const { featured, featuredInBlock, gallery } = entry;
  return {
    ...entry, ...fromFile, featured,
    ...(featuredInBlock === undefined ? {} : { featuredInBlock }),
    ...(gallery === undefined ? {} : { gallery }),
  };
}

/**
 * Replace the published file and poster for shown or hidden automata that were re-read.
 * Updates file-derived readout fields while preserving labels, publication timestamps,
 * owner marks, and gallery placement in a single index write. Callers must verify via
 * rereadProblem that only reading and preview fields changed.
 */
export async function replaceMaterialFiles(submissions: Bucket, library: Bucket, files: ReadonlyMap<string, FigureMaterialFile>): Promise<ReplacedMaterialFiles> {
  let index = await readMaterials(library);
  const shownEntries = new Map(index.entries.map((entry) => [entry.id, entry]));
  const result: ReplacedMaterialFiles = { shown: [], hidden: [], absent: [] };
  for (const [id, file] of files) {
    const entry = shownEntries.get(id);
    const record = entry === undefined ? await submissions.get(hiddenMaterialKey(id)) : null;
    const holder: MaterialEntry | null = entry ?? (record === null ? null : JSON.parse(await record.text()) as HiddenMaterial);
    if (holder === null) {
      result.absent.push(id);
      continue;
    }
    const fromFile = await putMaterialObjects(library, id, file, { title: holder.title, credit: holder.credit }, new Date(holder.publishedAt));
    const replaced = entryWithFile(holder, fromFile);
    if (entry !== undefined) {
      index = withMaterialEntry(index, replaced);
      result.shown.push(id);
    } else {
      await submissions.put(hiddenMaterialKey(id), JSON.stringify(replaced, null, 2), { httpMetadata: { contentType: "application/json" } });
      result.hidden.push(id);
    }
  }
  if (result.shown.length > 0) await writeMaterials(library, index);
  return result;
}

/**
 * Assign gallery grid places to shown entries in one index write.
 * Skips ids not in the index and returns the count of updated entries.
 */
export async function setGalleryPlaces(library: Bucket, places: ReadonlyMap<string, GalleryPlace>): Promise<number> {
  const index = await readMaterials(library);
  let changed = 0;
  const entries = index.entries.map((entry) => {
    const place = places.get(entry.id);
    if (place === undefined || (entry.gallery?.start === place.start && entry.gallery.method === place.method)) return entry;
    changed++;
    return { ...entry, gallery: place };
  });
  if (changed > 0) await writeMaterials(library, { entries });
  return changed;
}

/**
 * Apply an exclusive boolean mark to one shown automaton within its basis group scope.
 * Clears the mark from matching peers in a single index write and returns all modified entries,
 * with the chosen entry first. Rejects hidden or unknown automata.
 */
async function markOne(
  submissions: Bucket, library: Bucket, id: string,
  rule: { marked: (entry: MaterialEntry) => boolean; among: (chosen: MaterialEntry, other: MaterialEntry) => boolean; mark: (entry: MaterialEntry, on: boolean) => MaterialEntry },
): Promise<MaterialEntry[]> {
  checkedEntryId(id);
  const index = await readMaterials(library);
  const chosen = index.entries.find((entry) => entry.id === id);
  if (chosen === undefined) {
    const hidden = await submissions.get(hiddenMaterialKey(id));
    throw new ConflictError(hidden === null ? `no published automaton ${id}` : `${id} is hidden: show it first`);
  }
  const changed: MaterialEntry[] = [];
  const entries = index.entries.map((entry) => {
    const on = entry.id === id;
    if (!on && !(entry.block === chosen.block && rule.among(chosen, entry))) return entry;
    if (rule.marked(entry) === on) return entry;
    const next = rule.mark(entry, on);
    if (on) changed.unshift(next);
    else changed.push(next);
    return next;
  });
  if (changed.length > 0) await writeMaterials(library, { entries });
  return changed;
}

/** Mark one shown automaton as the representative for its start-and-method cell in its basis group. */
export function setCellPicture(submissions: Bucket, library: Bucket, id: string): Promise<MaterialEntry[]> {
  return markOne(submissions, library, id, {
    marked: (entry) => entry.cellPicture === true,
    among: (chosen, other) => samePlace(placeOf(chosen), placeOf(other)),
    mark: (entry, on) => ({ ...entry, cellPicture: on }),
  });
}

/** Mark one shown automaton as the representative for its basis group without altering the site featured mark. */
export function setGroupPicture(submissions: Bucket, library: Bucket, id: string): Promise<MaterialEntry[]> {
  return markOne(submissions, library, id, {
    marked: (entry) => entry.featuredInBlock === true,
    among: () => true,
    mark: (entry, on) => ({ ...entry, featuredInBlock: on }),
  });
}

/** List pending material submissions oldest first. Canvas submissions are handled by review.ts. */
export async function pendingMaterials(submissions: Bucket): Promise<MaterialSubmissionMetadata[]> {
  const keys = await listKeys(submissions, "pending/");
  const ids = keys.filter((key) => key.endsWith("/meta.json")).map((key) => key.split("/")[1] ?? "").sort();
  const metadataRecords = await Promise.all(ids.map(async (id) => JSON.parse(await (await requiredObject(submissions, pendingMaterialKey(id, "meta.json"))).text()) as { kind?: string }));
  return metadataRecords.filter((metadata): metadata is MaterialSubmissionMetadata => metadata.kind === "material");
}

/**
 * Approve one pending material: revalidate the stored file, publish it, then delete pending objects.
 * When the entry is already published or hidden, finish pending cleanup and return the existing entry.
 */
export async function approveMaterial(submissions: Bucket, library: Bucket, id: string, now: Date): Promise<MaterialEntry> {
  const found = await findMaterial(submissions, library, id);
  if (found !== null) {
    await submissions.delete(await listKeys(submissions, `pending/${id}/`));
    return found.entry;
  }
  const metaObject = await submissions.get(pendingMaterialKey(id, "meta.json"));
  if (metaObject === null) throw new ConflictError(`no pending automaton ${id}`);
  const metadata = JSON.parse(await metaObject.text()) as MaterialSubmissionMetadata;
  const checked = checkedMaterial(await (await requiredObject(submissions, pendingMaterialKey(id, "material.json"))).text());
  if ("error" in checked) throw new ConflictError(`${id}: ${checked.error}`);
  const holder = await entryWithMaterialId(submissions, library, checked.file.id);
  if (holder !== null) throw new ConflictError(`${id}: the ${holder.state} automaton ${holder.id} already has the file id ${checked.file.id}`);
  const entry = await publishMaterial(library, id, checked.file, metadata, now);
  await submissions.delete(PENDING_FILES.map((file) => pendingMaterialKey(id, file)));
  return entry;
}

/**
 * Find any shown or hidden automaton that already uses this file id.
 * File ids are unique across the site and local storage (app/src/storage/materials.ts),
 * so approval rejects duplicates.
 */
async function entryWithMaterialId(submissions: Bucket, library: Bucket, materialId: string): Promise<{ state: "shown" | "hidden"; id: string } | null> {
  const shown = (await readMaterials(library)).entries.find((entry) => entry.materialId === materialId);
  if (shown !== undefined) return { state: "shown", id: shown.id };
  const hidden = (await hiddenMaterials(submissions)).find((entry) => entry.materialId === materialId);
  return hidden === undefined ? null : { state: "hidden", id: hidden.id };
}

/** List every hidden material record in key order. */
export async function hiddenMaterials(submissions: Bucket): Promise<HiddenMaterial[]> {
  const hiddenKeys = (await listKeys(submissions, "hidden/materials/")).sort();
  return Promise.all(hiddenKeys.map(async (key) => JSON.parse(await (await requiredObject(submissions, key)).text()) as HiddenMaterial));
}

/** Preserve the exact stored bytes, including whitespace in an older definition.
 * A separately stored PNG must match the embedded preview before its URL can share the definition's digest.
 */
async function copyPublishedVersion(library: Bucket, id: string): Promise<string> {
  checkedEntryId(id);
  const definition = new Uint8Array(await (await requiredObject(library, materialKey(id, "material.json"))).arrayBuffer());
  const poster = new Uint8Array(await (await requiredObject(library, materialKey(id, "poster.png"))).arrayBuffer());
  const file = readFigureMaterial(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(definition))).file;
  const embedded = materialPoster(file);
  if (embedded.length !== poster.length || !embedded.every((byte, index) => byte === poster[index])) {
    throw new Error(`${id}: the stored poster differs from the definition's embedded preview`);
  }
  return putMaterialVersion(library, id, definition, poster);
}

/** Count older entries. With write, copy their file pairs before exposing revisions in the existing records. */
export async function migrateMaterialVersions(submissions: Bucket, library: Bucket, write: boolean): Promise<{ shown: number; hidden: number }> {
  const index = await readMaterials(library);
  const shown = index.entries.filter((entry) => entry.fileRevision === undefined);
  const hidden = (await hiddenMaterials(submissions)).filter((record) => record.fileRevision === undefined);
  if (!write) return { shown: shown.length, hidden: hidden.length };

  const activated = { shown: 0, hidden: 0 };
  if (shown.length > 0) {
    const revisions = new Map<string, string>();
    for (const entry of shown) revisions.set(entry.id, await copyPublishedVersion(library, entry.id));
    // Copying a gallery can take minutes. Merge into the current index to keep intervening owner edits.
    const current = await readMaterials(library);
    const entries = current.entries.map((entry) => {
      const fileRevision = revisions.get(entry.id);
      if (fileRevision === undefined || entry.fileRevision !== undefined) return entry;
      activated.shown++;
      return { ...entry, fileRevision };
    });
    if (activated.shown > 0) await writeMaterials(library, { entries });
  }
  for (const record of hidden) {
    const fileRevision = await copyPublishedVersion(library, record.id);
    const key = hiddenMaterialKey(record.id);
    const stored = await submissions.get(key);
    // The owner can restore the entry while the migration copies files.
    if (stored === null) continue;
    const current = JSON.parse(await stored.text()) as HiddenMaterial;
    if (current.fileRevision !== undefined) continue;
    await submissions.put(key, JSON.stringify({ ...current, fileRevision }, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });
    activated.hidden++;
  }
  return activated;
}

/** Shown, hidden and pending materials: everything the owner can act on. */
export async function materialEntries(submissions: Bucket, library: Bucket): Promise<{ pending: MaterialSubmissionMetadata[]; published: MaterialEntry[]; hidden: HiddenMaterial[] }> {
  const pending = await pendingMaterials(submissions);
  const published = (await readMaterials(library)).entries;
  const hidden = await hiddenMaterials(submissions);
  return { pending, published, hidden };
}

export async function findMaterial(submissions: Bucket, library: Bucket, id: string):
  Promise<{ state: "published"; entry: MaterialEntry } | { state: "hidden"; entry: HiddenMaterial } | null> {
  checkedEntryId(id);
  const published = (await readMaterials(library)).entries.find((entry) => entry.id === id);
  if (published !== undefined) return { state: "published", entry: published };
  const stored = await submissions.get(hiddenMaterialKey(id));
  return stored === null ? null : { state: "hidden", entry: JSON.parse(await stored.text()) as HiddenMaterial };
}

/** Take a shown material out of the index and keep its objects; restore undoes it. */
export async function hideMaterial(submissions: Bucket, library: Bucket, id: string, now: Date): Promise<HiddenMaterial> {
  checkedEntryId(id);
  const index = await readMaterials(library);
  const entry = index.entries.find((shown) => shown.id === id);
  if (entry === undefined) throw new ConflictError(`no published automaton definition ${id}`);
  const hidden: HiddenMaterial = { ...entry, hiddenAt: now.toISOString() };
  await submissions.put(hiddenMaterialKey(id), JSON.stringify(hidden, null, 2), { httpMetadata: { contentType: "application/json" } });
  await writeMaterials(library, withoutMaterialEntry(index, id));
  return hidden;
}

/** Put a hidden material back at its original place, then delete its private record. */
export async function restoreMaterial(submissions: Bucket, library: Bucket, id: string): Promise<MaterialEntry> {
  checkedEntryId(id);
  const stored = await submissions.get(hiddenMaterialKey(id));
  if (stored === null) throw new ConflictError(`no hidden automaton definition ${id}`);
  const { hiddenAt: _hiddenAt, ...entry } = JSON.parse(await stored.text()) as HiddenMaterial;
  await writeMaterials(library, withMaterialEntry(await readMaterials(library), entry));
  await submissions.delete(hiddenMaterialKey(id));
  return entry;
}

/**
 * Mark a shown automaton as featured, or clear the mark. The Home page picks from featured
 * automata, and the Automata page highlights them. Skips writing when the mark is unchanged.
 * A hidden automaton keeps its mark in its record and cannot change it until shown.
 */
export async function setMaterialFeatured(submissions: Bucket, library: Bucket, id: string, featured: boolean): Promise<MaterialEntry> {
  checkedEntryId(id);
  const index = await readMaterials(library);
  const entry = index.entries.find((shown) => shown.id === id);
  if (entry === undefined) {
    const hidden = await submissions.get(hiddenMaterialKey(id));
    throw new ConflictError(hidden === null ? `no published material ${id}` : `${id} is hidden: show it first`);
  }
  if ((entry.featured ?? false) === featured) return entry;
  const marked = { ...entry, featured };
  await writeMaterials(library, { entries: index.entries.map((shown) => (shown.id === id ? marked : shown)) });
  return marked;
}

/** Delete a shown or hidden material permanently: remove public objects first, then the records. */
export async function purgeMaterial(submissions: Bucket, library: Bucket, id: string): Promise<void> {
  const found = await findMaterial(submissions, library, id);
  if (found === null) throw new ConflictError(`no published or hidden automaton definition ${id}`);
  // R2 accepts at most 1,000 keys in one delete. List first so deletion cannot change a subsequent list page.
  const keys = await listKeys(library, `gallery/materials/${id}/`);
  const deleteLimit = 1000;
  for (let first = 0; first < keys.length; first += deleteLimit) {
    await library.delete(keys.slice(first, first + deleteLimit));
  }
  // Its link-preview poster and video (link-preview.ts), when it has them: a purge leaves no public picture.
  const preview = previewKeys(id);
  await library.delete([preview.image, preview.video]);
  if (found.state === "published") await writeMaterials(library, withoutMaterialEntry(await readMaterials(library), id));
  await submissions.delete(hiddenMaterialKey(id));
}
