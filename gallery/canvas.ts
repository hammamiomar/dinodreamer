// Canvas gallery review commands: pnpm run <list | approve | reject | hide | restore | purge | recover>
//
//   node canvas.ts list                     list pending, shown, and hidden canvas entries
//   node canvas.ts approve <id>             publish one pending submission
//   node canvas.ts approve --all            publish every listed pending submission after confirmation
//   node canvas.ts reject <id>              delete one pending submission
//   node canvas.ts hide <id>                remove a shown entry from the index and keep its objects
//   node canvas.ts restore <id>             put a hidden entry back into the index
//   node canvas.ts purge <id>               permanently delete a shown or hidden entry after confirmation
//   node canvas.ts recover <id> [directory] rebuild a submission as a creation JSON file

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { confirmed, libraryCdnBaseUrl, openBuckets, terminalText } from "./review-cli.ts";
import { APP_ORIGIN, PURGE_BY_PREFIX_PLACE, checkCopies, curlCommand, purgePrefix } from "./src/cdn-check.ts";
import { approve, approveAll, findEntry, galleryEntries, hide, pendingSubmissions, purge, recoverCreation, reject, restore } from "./src/review.ts";
import { PUBLISHED_FILES, publishedKey } from "./src/storage.ts";
import { sharpThumbnail } from "./src/thumbnail-sharp.ts";

export type CanvasCommand =
  | { kind: "list" }
  | { kind: "approve"; all: true }
  | { kind: "approve"; all: false; id: string }
  | { kind: "reject"; id: string }
  | { kind: "hide"; id: string }
  | { kind: "restore"; id: string }
  | { kind: "purge"; id: string }
  | { kind: "recover"; id: string; directory: string };

const USAGE = "usage: node canvas.ts <list | approve <id> | approve --all | reject <id> | hide <id> | restore <id> | purge <id> | recover <id> [directory]>";

/** Parse CLI arguments for the canvas review commands. Returns `{ ok: false, message }` when arguments are invalid. */
export function parseCanvasArgs(argv: string[]): { ok: true; command: CanvasCommand } | { ok: false; message: string } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { all: { type: "boolean", default: false } },
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const [subcommand, id, directory] = parsed.positionals;
  const all = parsed.values.all === true;
  if (subcommand === "list") return all ? { ok: false, message: USAGE } : { ok: true, command: { kind: "list" } };
  if (subcommand === "approve") {
    if (all) return id === undefined ? { ok: true, command: { kind: "approve", all: true } } : { ok: false, message: "usage: pnpm run approve --all" };
    return id ? { ok: true, command: { kind: "approve", all: false, id } } : { ok: false, message: "usage: pnpm run approve <submission id>   (list the entries with: pnpm run list)" };
  }
  if (all) return { ok: false, message: USAGE };
  if (subcommand === "reject" || subcommand === "hide" || subcommand === "restore" || subcommand === "purge") {
    return id ? { ok: true, command: { kind: subcommand, id } } : { ok: false, message: `usage: pnpm run ${subcommand} <submission id>   (list the entries with: pnpm run list)` };
  }
  if (subcommand === "recover") {
    return id
      ? { ok: true, command: { kind: "recover", id, directory: directory ?? "." } }
      : { ok: false, message: "usage: pnpm run recover <submission id> [directory]   (list the entries with: pnpm run list)" };
  }
  return { ok: false, message: USAGE };
}

async function listEntries(): Promise<void> {
  const { submissions, library } = openBuckets();
  const { pending, published, hidden } = await galleryEntries(submissions, library);

  console.log(`Pending: ${pending.length}   (pnpm run approve <id> | approve --all | reject <id>)`);
  for (const metadata of pending) console.log(`  ${metadata.id}  submitted ${metadata.submittedAt}  "${terminalText(metadata.title)}"  by "${terminalText(metadata.credit)}"  (${metadata.release})`);
  console.log(`Shown: ${published.length}   (pnpm run hide <id> | purge <id>)`);
  for (const entry of published) console.log(`  ${entry.id}  published ${entry.publishedAt}  "${terminalText(entry.title)}"  by "${terminalText(entry.credit)}"`);
  console.log(`Hidden: ${hidden.length}   (pnpm run restore <id> | purge <id>)`);
  for (const entry of hidden) console.log(`  ${entry.id}  hidden ${entry.hiddenAt}  "${terminalText(entry.title)}"  by "${terminalText(entry.credit)}"`);
  if (pending.length > 0) {
    console.log("Look at a pending image: pnpm exec wrangler r2 object get dinodreamer-submissions/pending/<id>/image.png --remote --file <id>.png");
  }
}

async function approveEntries(command: Extract<CanvasCommand, { kind: "approve" }>): Promise<void> {
  const { submissions, library } = openBuckets();
  if (command.all) {
    const pending = await pendingSubmissions(submissions);
    if (pending.length === 0) {
      console.log("0 pending");
      return;
    }
    for (const metadata of pending) console.log(`  ${metadata.id}  "${terminalText(metadata.title)}"  by "${terminalText(metadata.credit)}"`);
    if (!(await confirmed(`Publish these ${pending.length}?`))) {
      console.log("Nothing published");
      process.exitCode = 1;
      return;
    }
    const ids = pending.map((metadata) => metadata.id);
    const entries = await approveAll(submissions, library, ids, new Date(), sharpThumbnail);
    console.log(`Published ${entries.length}: ${entries.map((entry) => entry.id).join(", ")}`);
    return;
  }
  const entry = await approve(submissions, library, command.id, new Date(), sharpThumbnail);
  console.log(`Published ${entry.id} at <ASSET_BASE_URL>/${entry.imageUrl}, thumbnail ${entry.thumbnailUrl}`);
}

async function purgeEntry(id: string): Promise<void> {
  const base = libraryCdnBaseUrl();
  const { submissions, library } = openBuckets();
  const found = await findEntry(submissions, library, id);
  if (found === null) {
    console.error(`no published or hidden entry ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${found.state}: ${id}  "${terminalText(found.entry.title)}"  by "${terminalText(found.entry.credit)}"  published ${found.entry.publishedAt}`);
  console.log(`Purge deletes its image, thumbnail, recipe and index entry. It cannot be undone; pnpm run recover ${id} keeps a copy first.`);
  if (!(await confirmed("Purge it?"))) {
    console.log("Nothing deleted");
    process.exitCode = 1;
    return;
  }
  await purge(submissions, library, id);
  console.log(`Purged ${id} from the buckets.`);

  // Wrangler's login cannot purge Cloudflare edge caches, so print manual prefix purge instructions and check this edge.
  const urls = PUBLISHED_FILES.map((file) => `${base}/${publishedKey(id, file)}`);
  console.log(`
The CDN edge can still serve cached copies. Purge them now:
  ${PURGE_BY_PREFIX_PLACE}:
  ${purgePrefix(base, id)}
A purge by URL in the dashboard does not clear the copies cached with an Origin header. Clearing those by URL
needs the API purge with the header, which needs a Cache Purge token (not set up).
After the purge, each of these must print 404 (from this machine's edge only):`);
  for (const url of urls) {
    console.log(`  ${curlCommand(url)}`);
    console.log(`  ${curlCommand(url, APP_ORIGIN)}`);
  }

  console.log("\nWhat this machine's edge answers now:");
  for (const check of await checkCopies(urls)) {
    console.log(`  ${check.state.padEnd(11)}  ${check.origin === undefined ? "no Origin  " : "app Origin "}  ${check.url}  (${check.detail})`);
  }
}

async function main(): Promise<void> {
  const parsed = parseCanvasArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.message);
    process.exitCode = 2;
    return;
  }
  const { command } = parsed;
  switch (command.kind) {
    case "list": {
      await listEntries();
      break;
    }
    case "approve": {
      await approveEntries(command);
      break;
    }
    case "reject": {
      const { submissions } = openBuckets();
      await reject(submissions, command.id);
      console.log(`Deleted pending submission ${command.id}`);
      break;
    }
    case "hide": {
      const { submissions, library } = openBuckets();
      const hidden = await hide(submissions, library, command.id, new Date());
      console.log(`Hid ${hidden.id} "${terminalText(hidden.title)}". A gallery loaded after its 60 s cache does not list it; pnpm run restore ${command.id} brings it back.`);
      break;
    }
    case "restore": {
      const { submissions, library } = openBuckets();
      const entry = await restore(submissions, library, command.id);
      console.log(`Restored ${entry.id} "${terminalText(entry.title)}", published ${entry.publishedAt}`);
      break;
    }
    case "purge": {
      await purgeEntry(command.id);
      break;
    }
    case "recover": {
      const { submissions, library } = openBuckets();
      const { title, text } = await recoverCreation(submissions, library, command.id);
      const path = join(command.directory, `${command.id}.dinodreamer.json`);
      writeFileSync(path, text);
      console.log(`Wrote "${terminalText(title)}" to ${path}; import it on the app's Saved page`);
      break;
    }
    default: {
      const exhaustive: never = command;
      throw new Error(`unexpected command: ${String(exhaustive)}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await main();
