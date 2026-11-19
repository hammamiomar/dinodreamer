// The owner's review operations, run from the terminal commands and from the owner page
// (admin.ts): list the entries, approve pending submissions into the public gallery or reject
// them, hide and restore published entries, purge one for good, or rebuild one as a creation
// file for the app. Each takes the buckets it reads and changes explicitly; approve also takes
// its thumbnail encoder, because the terminal and the Worker encode differently (thumbnail.ts).

import { creationFileText } from "./creation-file.ts";
import { withEntry, withoutEntry, EMPTY_INDEX, type GalleryEntry, type GalleryIndex } from "./gallery-index.ts";
import {
  CACHE_IMMUTABLE,
  CACHE_INDEX,
  ConflictError,
  INDEX_KEY,
  SUBMISSION_FILES,
  hiddenKey,
  listKeys,
  requiredObject,
  pendingKey,
  publishedKey,
  isSubmissionId,
  type Bucket,
  type SubmissionMetadata,
} from "./storage.ts";
import { THUMBNAIL_CONTENT_TYPE, type MakeThumbnail } from "./thumbnail.ts";

function checkedId(id: string): void {
  if (!isSubmissionId(id)) throw new ConflictError(`"${id}" is not a submission id, such as 20261011-153012-a1b2c3d4`);
}

async function readIndex(library: Bucket): Promise<GalleryIndex> {
  const stored = await library.get(INDEX_KEY);
  return stored === null ? EMPTY_INDEX : (JSON.parse(await stored.text()) as GalleryIndex);
}

async function writeIndex(library: Bucket, index: GalleryIndex): Promise<void> {
  await library.put(INDEX_KEY, JSON.stringify(index, null, 2), {
    httpMetadata: { contentType: "application/json", cacheControl: CACHE_INDEX },
  });
}

/** hidden/<id>.json: the index entry as it was published, and when it was hidden. */
export interface HiddenEntry extends GalleryEntry {
  hiddenAt: string;
}

async function readHidden(submissions: Bucket, id: string): Promise<HiddenEntry | null> {
  const stored = await submissions.get(hiddenKey(id));
  return stored === null ? null : (JSON.parse(await stored.text()) as HiddenEntry);
}

/** Complete pending submissions, oldest first. A submission without meta.json is still being written. */
export async function pendingSubmissions(submissions: Bucket): Promise<SubmissionMetadata[]> {
  const keys = await listKeys(submissions, "pending/");
  const ids = keys.filter((key) => key.endsWith("/meta.json")).map((key) => key.split("/")[1] ?? "");
  const metadataRecords = await Promise.all(ids.sort().map(async (id) => JSON.parse(await (await requiredObject(submissions, pendingKey(id, "meta.json"))).text()) as SubmissionMetadata & { kind?: string }));
  // Pending materials have their own review (material-review.ts).
  return metadataRecords.filter((metadata) => metadata.kind !== "material");
}

/**
 * The blocks that a pending submission's requests use, in the recipe's order: the owner page shows
 * them beside the picture. Null when the recipe is gone, as after an approval whose cleanup stopped.
 */
export async function pendingBlocks(submissions: Bucket, id: string): Promise<number[] | null> {
  const stored = await submissions.get(pendingKey(id, "recipe.json"));
  if (stored === null) return null;
  const recipe = JSON.parse(await stored.text()) as { requests?: { block?: unknown }[] };
  return (recipe.requests ?? []).map((request) => request.block).filter((block): block is number => typeof block === "number");
}

/**
 * Publish one pending submission: its image, a thumbnail of it and its recipe become public
 * immutable objects, the published index gains its entry, and the pending objects are
 * deleted. Each step can be repeated, so a failed approval is finished by running it again.
 * The index entry marks a complete publication: when the entry is already shown or hidden,
 * only the pending copy's cleanup is left, so the published objects and publishedAt stay.
 */
export async function approve(submissions: Bucket, library: Bucket, id: string, now: Date, makeThumbnail: MakeThumbnail): Promise<GalleryEntry> {
  const published = await findEntry(submissions, library, id);
  if (published !== null) {
    await submissions.delete(await listKeys(submissions, `pending/${id}/`));
    return published.entry;
  }
  const metaObject = await submissions.get(pendingKey(id, "meta.json"));
  if (metaObject === null) throw new ConflictError(`no pending submission ${id}`);
  const metadata = JSON.parse(await metaObject.text()) as SubmissionMetadata;
  const image = await (await requiredObject(submissions, pendingKey(id, "image.png"))).arrayBuffer();
  const recipe = await (await requiredObject(submissions, pendingKey(id, "recipe.json"))).text();
  const thumbnail = await makeThumbnail(image);
  await library.put(publishedKey(id, "image.png"), image, { httpMetadata: { contentType: "image/png", cacheControl: CACHE_IMMUTABLE } });
  await library.put(publishedKey(id, "thumbnail.webp"), thumbnail, {
    httpMetadata: { contentType: THUMBNAIL_CONTENT_TYPE, cacheControl: CACHE_IMMUTABLE },
  });
  await library.put(publishedKey(id, "recipe.json"), recipe, {
    httpMetadata: { contentType: "application/json", cacheControl: CACHE_IMMUTABLE },
  });
  const entry: GalleryEntry = {
    id,
    title: metadata.title,
    credit: metadata.credit,
    imageUrl: publishedKey(id, "image.png"),
    thumbnailUrl: publishedKey(id, "thumbnail.webp"),
    recipeUrl: publishedKey(id, "recipe.json"),
    publishedAt: now.toISOString(),
  };
  if (metadata.engine !== undefined) entry.engine = metadata.engine;
  await writeIndex(library, withEntry(await readIndex(library), entry));
  await submissions.delete(SUBMISSION_FILES.map((file) => pendingKey(id, file)));
  return entry;
}

/**
 * Approve the given pending submissions in the given order (the lists show them oldest first),
 * with one publication time. The command and the owner page pass the list they showed the owner,
 * so a submission that arrives after the question waits for the next review. A failure stops
 * the run; running it again finishes it.
 */
export async function approveAll(
  submissions: Bucket,
  library: Bucket,
  ids: string[],
  now: Date,
  makeThumbnail: MakeThumbnail,
): Promise<GalleryEntry[]> {
  const entries: GalleryEntry[] = [];
  for (const id of ids) entries.push(await approve(submissions, library, id, now, makeThumbnail));
  return entries;
}

/** Every entry the owner can act on: pending submissions, the shown entries of the index, and hidden entries. */
export async function galleryEntries(
  submissions: Bucket,
  library: Bucket,
): Promise<{ pending: SubmissionMetadata[]; published: GalleryEntry[]; hidden: HiddenEntry[] }> {
  const pending = await pendingSubmissions(submissions);
  const published = (await readIndex(library)).entries;
  const hiddenKeys = (await listKeys(submissions, "hidden/")).filter((key) => !key.startsWith("hidden/materials/")).sort();
  const hidden = await Promise.all(hiddenKeys.map(async (key) => JSON.parse(await (await requiredObject(submissions, key)).text()) as HiddenEntry));
  return { pending, published, hidden };
}

/** A published or hidden entry by id, or null when it is neither. */
export async function findEntry(
  submissions: Bucket,
  library: Bucket,
  id: string,
): Promise<{ state: "published"; entry: GalleryEntry } | { state: "hidden"; entry: HiddenEntry } | null> {
  checkedId(id);
  const published = (await readIndex(library)).entries.find((entry) => entry.id === id);
  if (published !== undefined) return { state: "published", entry: published };
  const hidden = await readHidden(submissions, id);
  return hidden === null ? null : { state: "hidden", entry: hidden };
}

/**
 * A submission as the creation file the app imports: a recovery copy for a visitor whose
 * local save is gone. A published or hidden one gives its title, time and engine from its
 * index entry; otherwise a pending one from meta.json. The published copy comes first: an
 * approval that stopped while deleting the pending copy leaves part of it behind.
 * The image and the recipe are the stored objects.
 */
export async function recoverCreation(submissions: Bucket, library: Bucket, id: string): Promise<{ title: string; text: string }> {
  const found = await findEntry(submissions, library, id);
  if (found !== null) {
    const entry = found.entry;
    const recipe = JSON.parse(await (await requiredObject(library, publishedKey(id, "recipe.json"))).text()) as unknown;
    const png = new Uint8Array(await (await requiredObject(library, publishedKey(id, "image.png"))).arrayBuffer());
    const creation = { title: entry.title, recipe, png, at: entry.publishedAt, ...(entry.engine === undefined ? {} : { engine: entry.engine }) };
    return { title: entry.title, text: creationFileText(creation) };
  }
  const pending = await submissions.get(pendingKey(id, "meta.json"));
  if (pending === null) throw new ConflictError(`no pending, published or hidden submission ${id}`);
  const metadata = JSON.parse(await pending.text()) as SubmissionMetadata;
  const recipe = JSON.parse(await (await requiredObject(submissions, pendingKey(id, "recipe.json"))).text()) as unknown;
  const png = new Uint8Array(await (await requiredObject(submissions, pendingKey(id, "image.png"))).arrayBuffer());
  const creation = { title: metadata.title, recipe, png, at: metadata.submittedAt, ...(metadata.engine === undefined ? {} : { engine: metadata.engine }) };
  return { title: metadata.title, text: creationFileText(creation) };
}

/** Delete one pending submission. A published entry is not affected. */
export async function reject(submissions: Bucket, id: string): Promise<void> {
  checkedId(id);
  const keys = await listKeys(submissions, `pending/${id}/`);
  if (keys.length === 0) throw new ConflictError(`no pending submission ${id}`);
  await submissions.delete(keys);
}

/**
 * Take a published entry out of the gallery and keep everything: its index entry is written
 * to the private bucket first (hidden/<id>.json), then the index loses it. Its image,
 * thumbnail and recipe stay on the public bucket and still answer at their own URLs.
 * A failed hide is finished by running it again; restore undoes it.
 */
export async function hide(submissions: Bucket, library: Bucket, id: string, now: Date): Promise<HiddenEntry> {
  checkedId(id);
  const index = await readIndex(library);
  const entry = index.entries.find((published) => published.id === id);
  if (entry === undefined) throw new ConflictError(`no published entry ${id}`);
  const hidden: HiddenEntry = { ...entry, hiddenAt: now.toISOString() };
  await submissions.put(hiddenKey(id), JSON.stringify(hidden, null, 2), { httpMetadata: { contentType: "application/json" } });
  await writeIndex(library, withoutEntry(index, id));
  return hidden;
}

/**
 * Put a hidden entry back into the gallery at its original place (its publishedAt), then
 * delete its private record. A failed restore is finished by running it again.
 */
export async function restore(submissions: Bucket, library: Bucket, id: string): Promise<GalleryEntry> {
  checkedId(id);
  const hidden = await readHidden(submissions, id);
  if (hidden === null) throw new ConflictError(`no hidden entry ${id}`);
  const { hiddenAt: _hiddenAt, ...entry } = hidden;
  await writeIndex(library, withEntry(await readIndex(library), entry));
  await submissions.delete(hiddenKey(id));
  return entry;
}

/**
 * Delete a published or hidden entry permanently: remove public objects first, then the index
 * entry, then any hidden record so an interrupted purge remains listed and can be retried.
 */
export async function purge(submissions: Bucket, library: Bucket, id: string): Promise<void> {
  const found = await findEntry(submissions, library, id);
  if (found === null) throw new ConflictError(`no published or hidden entry ${id}`);
  await library.delete(await listKeys(library, `gallery/${id}/`));
  if (found.state === "published") await writeIndex(library, withoutEntry(await readIndex(library), id));
  await submissions.delete(hiddenKey(id));
}
