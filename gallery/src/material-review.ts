// Materials in the gallery: a submitted format-4 material file, pending in the private bucket
// until the owner approves it from the terminal or the owner page; approval publishes the file
// and its poster and rewrites published/materials.json. Every entry comes from a file
// checked by the app's own loader; shader source is never stored.
//
//   private bucket  pending/<id>/material.json, poster.png, meta.json        (meta.json last)
//                   hidden/materials/<id>.json                               (a hidden entry)
//   public bucket   gallery/materials/<id>/material.json, poster.png         (immutable once approved)
//                   published/materials.json                                 (shown entries only)

import { canonicalFigureFile, readFigureMaterial, readingPictureSide, type FigureMaterialFile } from "../../app/src/materials/material-file.ts";
import {
  EMPTY_MATERIAL_INDEX, MATERIAL_INDEX_KEY, isMaterialEntryId, materialEntry, materialKey, readMaterialIndex,
  withMaterialEntry, withoutMaterialEntry, type MaterialEntry, type MaterialIndex,
} from "../../app/src/features/gallery/material-index.ts";
import { MATERIAL_SUBMISSION_LIMITS } from "../../app/src/features/gallery/submission-label.ts";
import { CACHE_IMMUTABLE, CACHE_INDEX, isPng, listKeys, requiredObject, type Bucket } from "./storage.ts";
import { previewKeys } from "./link-preview.ts";

/** The dictionary of the current release; a material of another dictionary reads other codes. */
export const MATERIAL_DICTIONARIES: readonly string[] = ["monet-dtd-seed9-20261004-pass-003"];
export const MATERIAL_LIMITS = { materialBytes: 256 * 1024, ...MATERIAL_SUBMISSION_LIMITS } as const;
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
  if (!isMaterialEntryId(id)) throw new Error(`"${id}" is not an entry id for an automaton definition`);
  return id;
}

/**
 * Publish one checked file under an entry id: the file and its poster become public immutable
 * objects, then the index gains the entry. Approval and the project's seed both come here.
 * Running it again with the same id rewrites the same objects and entry, and keeps the owner's
 * featured mark: a reseed never clears it.
 */
export async function publishMaterial(library: Bucket, id: string, given: FigureMaterialFile, label: { title: string; credit: string }, now: Date): Promise<MaterialEntry> {
  const published = await putMaterialObjects(library, id, given, label, now);
  const index = await readMaterials(library);
  const entry = { ...published, featured: index.entries.find((shown) => shown.id === id)?.featured ?? false };
  await writeMaterials(library, withMaterialEntry(index, entry));
  return entry;
}

/** A material's two public objects, the canonical file and its poster, and the entry that names them. */
async function putMaterialObjects(library: Bucket, id: string, given: FigureMaterialFile, label: { title: string; credit: string }, now: Date): Promise<MaterialEntry> {
  const file = canonicalFigureFile(given);
  const entry = materialEntry(checkedEntryId(id), file, label, now.toISOString());
  const poster = materialPoster(file);
  await library.put(materialKey(id, "material.json"), JSON.stringify(file), { httpMetadata: { contentType: "application/json", cacheControl: CACHE_IMMUTABLE } });
  await library.put(materialKey(id, "poster.png"), poster, { httpMetadata: { contentType: "image/png", cacheControl: CACHE_IMMUTABLE } });
  return entry;
}

/**
 * One material for publishMaterials; `hidden` publishes its objects and keeps it out of the index, and
 * `featured` is the owner's mark, kept in the hidden record too.
 */
export interface MaterialToPublish { id: string; file: FigureMaterialFile; label: { title: string; credit: string }; hidden: boolean; featured: boolean }

/**
 * Publish many materials in one pass: every file and poster, then the index written once, with a hidden
 * record for each hidden one (objects kept, out of the index, as hideMaterial leaves it). The production
 * seed comes here, so 172 materials cost one index write, not 172.
 */
export async function publishMaterials(submissions: Bucket, library: Bucket, materials: MaterialToPublish[], now: Date): Promise<{ shown: number; hidden: number }> {
  let index = await readMaterials(library);
  const hiddenBefore = new Set(await listKeys(submissions, "hidden/materials/"));
  for (const material of materials) {
    const entry = { ...(await putMaterialObjects(library, material.id, material.file, material.label, now)), featured: material.featured };
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

/** Pending material submissions, oldest first. Canvas submissions are review.ts's. */
export async function pendingMaterials(submissions: Bucket): Promise<MaterialSubmissionMetadata[]> {
  const keys = await listKeys(submissions, "pending/");
  const ids = keys.filter((key) => key.endsWith("/meta.json")).map((key) => key.split("/")[1] ?? "").sort();
  const metadataRecords = await Promise.all(ids.map(async (id) => JSON.parse(await (await requiredObject(submissions, pendingMaterialKey(id, "meta.json"))).text()) as { kind?: string }));
  return metadataRecords.filter((metadata): metadata is MaterialSubmissionMetadata => metadata.kind === "material");
}

/**
 * Approve one pending material: the stored file is checked again with the app's loader, then
 * published, then the pending objects are deleted. The entry's readouts come from the file.
 * When the entry is already shown or hidden, only the pending copy's cleanup is left.
 */
export async function approveMaterial(submissions: Bucket, library: Bucket, id: string, now: Date): Promise<MaterialEntry> {
  const found = await findMaterial(submissions, library, id);
  if (found !== null) {
    await submissions.delete(await listKeys(submissions, `pending/${id}/`));
    return found.entry;
  }
  const metadata = JSON.parse(await (await requiredObject(submissions, pendingMaterialKey(id, "meta.json"))).text()) as MaterialSubmissionMetadata;
  const checked = checkedMaterial(await (await requiredObject(submissions, pendingMaterialKey(id, "material.json"))).text());
  if ("error" in checked) throw new Error(`${id}: ${checked.error}`);
  const entry = await publishMaterial(library, id, checked.file, metadata, now);
  await submissions.delete(PENDING_FILES.map((file) => pendingMaterialKey(id, file)));
  return entry;
}

/** Shown, hidden and pending materials: everything the owner can act on. */
export async function materialEntries(submissions: Bucket, library: Bucket): Promise<{ pending: MaterialSubmissionMetadata[]; published: MaterialEntry[]; hidden: HiddenMaterial[] }> {
  const pending = await pendingMaterials(submissions);
  const published = (await readMaterials(library)).entries;
  const hiddenKeys = (await listKeys(submissions, "hidden/materials/")).sort();
  const hidden = await Promise.all(hiddenKeys.map(async (key) => JSON.parse(await (await requiredObject(submissions, key)).text()) as HiddenMaterial));
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
  if (entry === undefined) throw new Error(`no published automaton definition ${id}`);
  const hidden: HiddenMaterial = { ...entry, hiddenAt: now.toISOString() };
  await submissions.put(hiddenMaterialKey(id), JSON.stringify(hidden, null, 2), { httpMetadata: { contentType: "application/json" } });
  await writeMaterials(library, withoutMaterialEntry(index, id));
  return hidden;
}

/** Put a hidden material back at its original place, then delete its private record. */
export async function restoreMaterial(submissions: Bucket, library: Bucket, id: string): Promise<MaterialEntry> {
  checkedEntryId(id);
  const stored = await submissions.get(hiddenMaterialKey(id));
  if (stored === null) throw new Error(`no hidden automaton definition ${id}`);
  const { hiddenAt: _hiddenAt, ...entry } = JSON.parse(await stored.text()) as HiddenMaterial;
  await writeMaterials(library, withMaterialEntry(await readMaterials(library), entry));
  await submissions.delete(hiddenMaterialKey(id));
  return entry;
}

/**
 * Mark a shown material featured, or clear the mark: the home picks among the
 * featured ones, and the Playground lists them first. One index write; none when the mark is already
 * as asked. A hidden material keeps its mark in its record and cannot change it until it is shown.
 */
export async function setMaterialFeatured(submissions: Bucket, library: Bucket, id: string, featured: boolean): Promise<MaterialEntry> {
  checkedEntryId(id);
  const index = await readMaterials(library);
  const entry = index.entries.find((shown) => shown.id === id);
  if (entry === undefined) {
    const hidden = await submissions.get(hiddenMaterialKey(id));
    throw new Error(hidden === null ? `no published material ${id}` : `${id} is hidden: show it first`);
  }
  if ((entry.featured ?? false) === featured) return entry;
  const marked = { ...entry, featured };
  await writeMaterials(library, { entries: index.entries.map((shown) => (shown.id === id ? marked : shown)) });
  return marked;
}

/**
 * Count the index entries and hidden records without a featured mark,
 * and with `write`, give each featured: false (the index in one write, each hidden record once).
 * An entry that has the mark is never changed, so running it again changes nothing.
 */
export async function addFeaturedMarks(submissions: Bucket, library: Bucket, write: boolean): Promise<{ entries: number; hidden: number }> {
  const index = await readMaterials(library);
  const unmarked = index.entries.filter((entry) => entry.featured === undefined).length;
  const hiddenKeys = (await listKeys(submissions, "hidden/materials/")).sort();
  const records = await Promise.all(hiddenKeys.map(async (key) => ({ key, record: JSON.parse(await (await requiredObject(submissions, key)).text()) as HiddenMaterial })));
  const unmarkedRecords = records.filter(({ record }) => record.featured === undefined);
  if (write) {
    if (unmarked) await writeMaterials(library, { entries: index.entries.map((entry) => ({ ...entry, featured: entry.featured ?? false })) });
    for (const { key, record } of unmarkedRecords) {
      await submissions.put(key, JSON.stringify({ ...record, featured: false }, null, 2), { httpMetadata: { contentType: "application/json" } });
    }
  }
  return { entries: unmarked, hidden: unmarkedRecords.length };
}

/** Delete a shown or hidden material for good: public objects first, then the records. */
export async function purgeMaterial(submissions: Bucket, library: Bucket, id: string): Promise<void> {
  const found = await findMaterial(submissions, library, id);
  if (found === null) throw new Error(`no published or hidden automaton definition ${id}`);
  await library.delete(await listKeys(library, `gallery/materials/${id}/`));
  // Its link-preview poster and video (link-preview.ts), when it has them: a purge leaves no public picture.
  const preview = previewKeys(id);
  await library.delete([preview.image, preview.video]);
  if (found.state === "published") await writeMaterials(library, withoutMaterialEntry(await readMaterials(library), id));
  await submissions.delete(hiddenMaterialKey(id));
}
