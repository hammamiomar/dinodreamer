// The owner's material commands, for the terminal: pnpm run materials <command> [argument] [--local <dir>]
//
//   list                 pending, shown and hidden materials
//   approve <id>         publish one pending material: its file, poster and index entry
//   reject <id>          delete one pending material
//   hide <id>            take a shown material out of the index; keep its objects
//   restore <id>         put a hidden material back
//   purge <id>           delete a shown or hidden material for good (asks y/N)
//   feature <id>         mark a shown material featured for the Home pool and Automata page
//   unfeature <id>       clear the mark
//   version-files [--write]
//                        count shown and hidden records that lack a file revision. With --write, copy their
//                        existing files to versioned library keys and update the records.
//   seed <folder>        publish every *.material.json in the folder as a project entry, except the
//                        hidden ones: a reseed does not undo the owner's hide or featured mark. The entry id
//                        is the file's id with every character that an entry id refuses made a hyphen
//                        ("delta-0.25" → "delta-0-25"); the entry keeps the file's own id as materialId
//   reread <folder> [--write]
//                        give shown or hidden automata a reading taken again: <folder>/<entry id>/material.json
//                        each holds the automaton's published file with only its reading and its preview
//                        replaced (research.ts, rereadProblem, checks that and nothing else changed). Its file,
//                        poster and entry, or its hidden record, take the new reading; its id, label, marks and
//                        place stay (material-review.ts, replaceMaterialFiles). Without --write a dry run that
//                        checks every file and counts them
//   seed-production <persist dir> [--production]
//                        copy the local Worker's published materials to Cloudflare, shown or hidden and
//                        featured or not as the owner left them in the local owner view; without --production a dry run that
//                        counts them by state and kind and writes nothing
//
// --local <dir> acts on the local Worker's buckets (`wrangler dev --local --persist-to <dir>`)
// instead of Cloudflare: the local owner page and the app served by that Worker see the result.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmed, libraryCdnBaseUrl, openBuckets, openLocalBuckets, terminalText } from "./review-cli.ts";
import { materialCdnPurge } from "./src/cdn-check.ts";
import { FIGURE_PYRAMID_LAYOUT, type FigureMaterialFile } from "../app/src/materials/material-file.ts";
import { materialKey } from "../app/src/features/gallery/material-index.ts";
import {
  approveMaterial, checkedMaterial, findMaterial, hideMaterial, materialEntries, migrateMaterialVersions, publishMaterials,
  purgeMaterial, readMaterials, replaceMaterialFiles, restoreMaterial, setMaterialFeatured,
} from "./src/material-review.ts";
import { reject } from "./src/review.ts";
import { rereadProblem } from "./src/research.ts";
import { localSeedMaterials, seedMaterialFolder } from "./material-seed.ts";

/** A material's kind in the site's words: the rule (fine, or coarse + fine), the start and the picture. */
function kindName(file: FigureMaterialFile): string {
  const rule = file.rule.layout === FIGURE_PYRAMID_LAYOUT ? "coarse + fine" : "fine";
  const start = file.start?.kind === "centre-disc" ? "seeded" : "noise";
  return `${rule} · ${start}${file.picture?.pixelsPerCell === 2 ? " · 2 px per cell" : ""}`;
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
    for (const metadata of pending) console.log(`  ${metadata.id}  block ${metadata.block}  "${terminalText(metadata.title)}"  by "${terminalText(metadata.credit)}"  (${terminalText(metadata.materialId)})`);
    console.log(`Shown: ${published.length}, featured ${published.filter((entry) => entry.featured).length}   (hide <id> | purge <id> | feature <id> | unfeature <id>)`);
    for (const entry of published) {
      console.log(`  ${entry.id}  block ${entry.block}  ${entry.band}  ${reading(entry)}${entry.featured ? "  featured" : ""}  "${terminalText(entry.title)}"`);
    }
    console.log(`Hidden: ${hidden.length}   (restore <id> | purge <id>)`);
    for (const entry of hidden) console.log(`  ${entry.id}  block ${entry.block}  hidden ${entry.hiddenAt}  "${terminalText(entry.title)}"`);
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
  } else if (command === "version-files") {
    const write = args.includes("--write");
    const { shown, hidden } = await migrateMaterialVersions(submissions, library, write);
    console.log(`${shown} shown and ${hidden} hidden automata ${write ? "received versioned library files." : "need versioned library files. Add --write to copy them."}`);
  } else if (command === "purge") {
    const found = await findMaterial(submissions, library, need("id"));
    if (found === null) throw new Error(`no published or hidden material ${argument}`);
    console.log(`${found.state}: ${found.entry.id}  block ${found.entry.block}  "${terminalText(found.entry.title)}"`);
    if (await confirmed("Purge its file, poster and index entry for good?")) {
      await purgeMaterial(submissions, library, found.entry.id);
      console.log(`Purged ${found.entry.id}`);
      if (!persistTo) {
        const cdn = materialCdnPurge(libraryCdnBaseUrl(), found.entry.id);
        console.log(`Remove the cached copies at ${cdn.place}\n${cdn.prefixes.join("\n")}`);
      }
    } else console.log("Nothing deleted");
  } else if (command === "seed") {
    const { publishedIds, keptHidden } = await seedMaterialFolder(submissions, library, need("folder"));
    if (publishedIds.length > 0 && publishedIds.length + keptHidden <= 10) {
      const entries = new Map((await readMaterials(library)).entries.map((entry) => [entry.id, entry]));
      for (const id of publishedIds) {
        const entry = entries.get(id)!;
        console.log(`  ${id}  block ${entry.block}  ${entry.fired ? "fired" : "did not fire"}  "${terminalText(entry.title)}"`);
      }
    }
    console.log(`Seeded ${publishedIds.length} project materials${keptHidden ? `; kept ${keptHidden} hidden` : ""}`);
  } else if (command === "reread") {
    const folder = need("folder");
    const write = args.includes("--write");
    const ids = readdirSync(folder, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort();
    const files = new Map<string, FigureMaterialFile>();
    const problems: string[] = [];
    for (const id of ids) {
      const text = readFileSync(join(folder, id, "material.json"), "utf8");
      const checked = checkedMaterial(text);
      if ("error" in checked) { problems.push(`${id}: ${checked.error}`); continue; }
      const stored = await library.get(materialKey(id, "material.json"));
      if (stored === null) { problems.push(`${id}: no published or hidden automaton holds this id`); continue; }
      const problem = rereadProblem(await stored.text(), JSON.stringify(checked.file));
      if (problem !== null) { problems.push(`${id}: ${problem}`); continue; }
      files.set(id, checked.file);
    }
    if (problems.length > 0) throw new Error(`Nothing was written. ${problems.length} files cannot replace theirs:\n${problems.join("\n")}`);
    if (!write) {
      console.log(`${files.size} automata may take their new reading. Dry run: nothing was written. Add --write to write them.`);
    } else {
      const replaced = await replaceMaterialFiles(submissions, library, files);
      console.log(`${replaced.shown.length} shown automata and ${replaced.hidden.length} hidden ones took their new reading; ${replaced.absent.length} were neither`);
    }
  } else if (command === "seed-production") {
    // The source is the local store named by the argument; the target is Cloudflare, and only with the flag.
    if (persistTo) throw new Error("seed-production reads the local store named by its argument and writes Cloudflare; drop --local");
    const local = await openLocalBuckets(need("local persist dir"));
    try {
      const { materials, pending } = await localSeedMaterials(local);
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
      + "version-files [--write] | reread <folder> [--write] | seed <folder> | seed-production <persist dir> [--production]> [--local <dir>]");
    process.exitCode = 2;
  }
} finally {
  await opened.close();
}
