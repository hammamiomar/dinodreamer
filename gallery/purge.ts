// Delete a published or hidden entry for good, after a y/N question: pnpm run purge <id>
//
// The library CDN caches gallery objects at the edge (immutable, a year), and wrangler's login
// cannot purge that cache. So the command always prints the manual cache purge for the entry,
// before it asks the CDN what this machine's edge still serves (src/cdn-check.ts).

import { confirmed, idArgument, libraryCdnBaseUrl, openBuckets, terminalText } from "./review-cli.ts";
import { APP_ORIGIN, PURGE_BY_PREFIX_PLACE, checkCopies, curlCommand, purgePrefix } from "./src/cdn-check.ts";
import { findEntry, purge } from "./src/review.ts";
import { PUBLISHED_FILES, publishedKey } from "./src/storage.ts";

const id = idArgument("purge");
const base = libraryCdnBaseUrl();
const { submissions, library } = openBuckets();
const found = await findEntry(submissions, library, id);
if (found === null) {
  console.error(`no published or hidden entry ${id}`);
  process.exit(1);
}
console.log(`${found.state}: ${id}  "${terminalText(found.entry.title)}"  by "${terminalText(found.entry.credit)}"  published ${found.entry.publishedAt}`);
console.log(`Purge deletes its image, thumbnail, recipe and index entry. It cannot be undone; pnpm run recover ${id} keeps a copy first.`);
if (!(await confirmed("Purge it?"))) {
  console.log("Nothing deleted");
  process.exit(1);
}
await purge(submissions, library, id);
console.log(`Purged ${id} from the buckets.`);

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
