// Prepare a seed from exported material files or an owner's local gallery.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMaterialEntryId, materialKey, type MaterialEntry } from "../app/src/features/gallery/material-index.ts";
import { readFigureMaterial } from "../app/src/materials/material-file.ts";
import { materialEntries, PROJECT_CREDIT, publishMaterials, type MaterialToPublish } from "./src/material-review.ts";
import type { Bucket } from "./src/storage.ts";

function seedSelection(entry: MaterialEntry | undefined, defaultTitle: string) {
  return {
    label: { title: entry?.title ?? defaultTitle, credit: entry?.credit ?? PROJECT_CREDIT },
    featured: entry?.featured === true,
    featuredInBlock: entry?.featuredInBlock,
    cellPicture: entry?.cellPicture,
    gallery: entry?.gallery,
  };
}

/** A project entry's id from its file's id: the selection-margin files name δ with a decimal point. */
function projectEntryId(fileId: string): string {
  const id = fileId.replace(/[^a-z0-9-]+/g, "-");
  if (!isMaterialEntryId(id)) throw new Error(`"${fileId}" gives no valid entry id`);
  return id;
}

/** Publish every *.material.json in a folder in one index write while preserving hidden entries and owner marks. */
export async function seedMaterialFolder(submissions: Bucket, library: Bucket, folder: string): Promise<{ publishedIds: string[]; keptHidden: number }> {
  const names = readdirSync(folder).filter((name) => name.endsWith(".material.json")).sort();
  const current = await materialEntries(submissions, library);
  const hidden = new Set(current.hidden.map((entry) => entry.id));
  const shownById = new Map(current.published.map((entry) => [entry.id, entry]));
  const toPublish: MaterialToPublish[] = [];
  for (const name of names) {
    const { file } = readFigureMaterial(JSON.parse(readFileSync(join(folder, name), "utf8")));
    const id = projectEntryId(file.id);
    if (hidden.has(id)) continue;
    const existing = shownById.get(id);
    toPublish.push({
      id,
      file,
      ...seedSelection(existing, file.name),
      hidden: false,
    });
  }
  if (toPublish.length > 0) await publishMaterials(submissions, library, toPublish, new Date());
  return { publishedIds: toPublish.map((item) => item.id), keptHidden: names.length - toPublish.length };
}

/** The local store's shown and hidden materials, each with its checked file, to copy to Cloudflare. */
export async function localSeedMaterials(local: { submissions: Bucket; library: Bucket }): Promise<{ materials: MaterialToPublish[]; pending: number }> {
  const { pending, published, hidden } = await materialEntries(local.submissions, local.library);
  const marked = [...published.map((entry) => ({ entry, hidden: false })), ...hidden.map((entry) => ({ entry, hidden: true }))];
  const materials = await Promise.all(marked.map(async ({ entry, hidden: isHidden }) => {
    const stored = await local.library.get(materialKey(entry.id, "material.json"));
    if (stored === null) throw new Error(`${entry.id}: the local store has no material.json`);
    const { file } = readFigureMaterial(JSON.parse(await stored.text()));
    return { id: entry.id, file, ...seedSelection(entry, file.name), hidden: isHidden };
  }));
  return { materials, pending: pending.length };
}
