// The owner's material commands, for the terminal: pnpm run materials <command> [argument] [--local <dir>]
//
//   list                 pending, shown and hidden materials
//   approve <id>         publish one pending material: its file, poster and index entry
//   reject <id>          delete one pending material
//   hide <id>            take a shown material out of the index; keep its objects
//   restore <id>         put a hidden material back
//   purge <id>           delete a shown or hidden material for good (asks y/N)
//   feature <id>         mark a shown material featured: the home's pool and the Playground's first group
//   unfeature <id>       clear the mark
//   add-featured [--write]
//                        count the index entries and hidden records without a
//                        featured mark; with --write, give each featured: false. Without it a dry run
//   seed <folder>        publish every *.material.json in the folder as a project entry, except the
//                        hidden ones: a reseed does not undo the owner's hide or featured mark. The entry id
//                        is the file's id with every character that an entry id refuses made a hyphen
//                        ("delta-0.25" → "delta-0-25"); the entry keeps the file's own id as materialId
//   seed-production <persist dir> [--production]
//                        copy the local Worker's published materials to Cloudflare, shown or hidden and
//                        featured or not as the owner left them in the local owner view; without --production a dry run that
//                        counts them by state and kind and writes nothing
//
// --local <dir> acts on the local Worker's buckets (`wrangler dev --local --persist-to <dir>`)
// instead of Cloudflare: the local owner page and the app served by that Worker see the result.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmed, openBuckets, openLocalBuckets } from "./review-cli.ts";
import { FIGURE_PYRAMID_LAYOUT, readFigureMaterial, type FigureMaterialFile } from "../app/src/materials/material-file.ts";
import { isMaterialEntryId, materialKey } from "../app/src/features/gallery/material-index.ts";
import {
  addFeaturedMarks, approveMaterial, findMaterial, hideMaterial, materialEntries, publishMaterial, publishMaterials, purgeMaterial, readMaterials,
  restoreMaterial, setMaterialFeatured, type MaterialToPublish,
} from "./src/material-review.ts";
import { reject } from "./src/review.ts";
import type { Bucket } from "./src/storage.ts";

/** The project's own entries are attributed to it, not to a visitor. */
const PROJECT_CREDIT = "DinoDreamer project";

/** A material's kind in the site's words: the rule (fine, or coarse + fine), the start and the picture. */
function kindName(file: FigureMaterialFile): string {
  const rule = file.rule.layout === FIGURE_PYRAMID_LAYOUT ? "coarse + fine" : "fine";
  const start = file.start?.kind === "centre-disc" ? "seeded" : "noise";
  return `${rule} · ${start}${file.picture?.pixelsPerCell === 2 ? " · 2 px per cell" : ""}`;
}

/** A project entry's id from its file's id: the selection-margin files name δ with a decimal point. */
function projectEntryId(fileId: string): string {
  const id = fileId.replace(/[^a-z0-9-]+/g, "-");
  if (!isMaterialEntryId(id)) throw new Error(`"${fileId}" gives no valid entry id`);
  return id;
}

/** The local store's shown and hidden materials, each with its checked file, to copy to Cloudflare. */
async function localMaterials(local: { submissions: Bucket; library: Bucket }): Promise<{ materials: MaterialToPublish[]; pending: number }> {
  const { pending, published, hidden } = await materialEntries(local.submissions, local.library);
  const marked = [...published.map((entry) => ({ entry, hidden: false })), ...hidden.map((entry) => ({ entry, hidden: true }))];
  const materials = await Promise.all(marked.map(async ({ entry, hidden: isHidden }) => {
    const stored = await local.library.get(materialKey(entry.id, "material.json"));
    if (stored === null) throw new Error(`${entry.id}: the local store has no material.json`);
    const { file } = readFigureMaterial(JSON.parse(await stored.text()));
    return { id: entry.id, file, label: { title: entry.title, credit: entry.credit }, hidden: isHidden, featured: entry.featured === true };
  }));
  return { materials, pending: pending.length };
}

const args = process.argv.slice(2);
const localAt = args.indexOf("--local");
const persistTo = localAt >= 0 ? args.splice(localAt, 2)[1] : undefined;
const [command, argument] = args;
if (localAt >= 0 && !persistTo) throw new Error("--local needs the wrangler persist directory");
const opened = persistTo ? await openLocalBuckets(persistTo) : { ...openBuckets(), close: async () => {} };
const { submissions, library } = opened;
const need = (what: string) => {
  if (!argument) throw new Error(`usage: pnpm run materials ${command} <${what}>${persistTo ? "" : " [--local <dir>]"}`);
  return argument;
};

try {
  if (command === "list") {
    const { pending, published, hidden } = await materialEntries(submissions, library);
    const reading = (entry: { fired: boolean; winnerFraction: number | null; strength: number | null }) =>
      `${entry.fired ? "fired" : "did not fire"}, wins ${entry.winnerFraction === null ? "—" : `${(entry.winnerFraction * 100).toFixed(1)}%`}, strength ${entry.strength?.toFixed(2) ?? "—"}`;
    console.log(`Pending: ${pending.length}   (pnpm run materials approve <id> | reject <id>)`);
    for (const metadata of pending) console.log(`  ${metadata.id}  block ${metadata.block}  "${metadata.title}"  by "${metadata.credit}"  (${metadata.materialId})`);
    console.log(`Shown: ${published.length}, featured ${published.filter((entry) => entry.featured).length}   (hide <id> | purge <id> | feature <id> | unfeature <id>)`);
    for (const entry of published) {
      console.log(`  ${entry.id}  block ${entry.block}  ${entry.band}  ${reading(entry)}${entry.featured ? "  featured" : ""}  "${entry.title}"`);
    }
    console.log(`Hidden: ${hidden.length}   (restore <id> | purge <id>)`);
    for (const entry of hidden) console.log(`  ${entry.id}  block ${entry.block}  hidden ${entry.hiddenAt}  "${entry.title}"`);
  } else if (command === "approve") {
    const entry = await approveMaterial(submissions, library, need("id"), new Date());
    console.log(`Published ${entry.id}: block ${entry.block}, ${entry.fired ? "fired" : "did not fire"}`);
  } else if (command === "reject") {
    await reject(submissions, need("id"));
    console.log(`Deleted pending material ${argument}`);
  } else if (command === "hide") {
    const hidden = await hideMaterial(submissions, library, need("id"), new Date());
    console.log(`Hid ${hidden.id}; pnpm run materials restore ${hidden.id} brings it back.`);
  } else if (command === "restore") {
    const entry = await restoreMaterial(submissions, library, need("id"));
    console.log(`Restored ${entry.id}, published ${entry.publishedAt}`);
  } else if (command === "feature" || command === "unfeature") {
    const entry = await setMaterialFeatured(submissions, library, need("id"), command === "feature");
    console.log(`${entry.id} is ${entry.featured ? "featured" : "not featured"}; /api/materials shows it after its minute's cache`);
  } else if (command === "add-featured") {
    const write = args.includes("--write");
    const missing = await addFeaturedMarks(submissions, library, write);
    console.log(`Without a featured mark: ${missing.entries} index entries, ${missing.hidden} hidden records`);
    console.log(write ? "Each now has featured: false." : "Dry run: nothing was written. Add --write to give each featured: false.");
  } else if (command === "purge") {
    const found = await findMaterial(submissions, library, need("id"));
    if (found === null) throw new Error(`no published or hidden material ${argument}`);
    console.log(`${found.state}: ${found.entry.id}  block ${found.entry.block}  "${found.entry.title}"`);
    if (await confirmed("Purge its file, poster and index entry for good?")) {
      await purgeMaterial(submissions, library, found.entry.id);
      console.log(`Purged ${found.entry.id}`);
    } else console.log("Nothing deleted");
  } else if (command === "seed") {
    const folder = need("folder");
    const names = readdirSync(folder).filter((name) => name.endsWith(".material.json")).sort();
    const hidden = new Set((await materialEntries(submissions, library)).hidden.map((entry) => entry.id));
    const now = new Date();
    let seeded = 0;
    for (const name of names) {
      const { file } = readFigureMaterial(JSON.parse(readFileSync(join(folder, name), "utf8")));
      const id = projectEntryId(file.id);
      if (hidden.has(id)) continue;
      const entry = await publishMaterial(library, id, file, { title: file.name, credit: PROJECT_CREDIT }, now);
      if (names.length <= 10) console.log(`  ${entry.id}  block ${entry.block}  ${entry.fired ? "fired" : "did not fire"}  "${entry.title}"`);
      seeded++;
    }
    console.log(`Seeded ${seeded} project materials${hidden.size ? `; kept ${names.length - seeded} hidden` : ""}`);
  } else if (command === "seed-production") {
    // The source is the local store named by the argument; the target is Cloudflare, and only with the flag.
    if (persistTo) throw new Error("seed-production reads the local store named by its argument and writes Cloudflare; drop --local");
    const local = await openLocalBuckets(need("local persist dir"));
    try {
      const { materials, pending } = await localMaterials(local);
      const shown = materials.filter((material) => !material.hidden).length;
      console.log(`Local store: ${shown} shown, ${materials.length - shown} hidden${pending ? `, ${pending} pending (not copied)` : ""}`);
      const kinds = new Map<string, number>();
      for (const material of materials) {
        const key = `${material.hidden ? "hidden" : "shown"} · ${kindName(material.file)}`;
        kinds.set(key, (kinds.get(key) ?? 0) + 1);
      }
      for (const [kind, count] of [...kinds].sort()) console.log(`  ${kind}: ${count}`);
      console.log(`Cloudflare's index lists ${(await readMaterials(library)).entries.length} materials now`);
      if (!args.includes("--production")) {
        console.log("Dry run: nothing was written. Add --production to copy them to Cloudflare.");
      } else {
        const result = await publishMaterials(submissions, library, materials, new Date());
        console.log(`Published ${result.shown} shown and ${result.hidden} hidden materials to Cloudflare; /api/materials lists them after its minute's cache`);
      }
    } finally {
      await local.close();
    }
  } else {
    console.error("usage: pnpm run materials <list | approve <id> | reject <id> | hide <id> | restore <id> | purge <id> | feature <id> | unfeature <id> | "
      + "add-featured [--write] | seed <folder> | seed-production <persist dir> [--production]> [--local <dir>]");
    process.exitCode = 2;
  }
} finally {
  await opened.close();
}
