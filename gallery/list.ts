// List the gallery's entries: pending submissions (oldest first), shown entries (newest
// first, as the gallery shows them) and hidden ones: pnpm run list

import { openBuckets, terminalText } from "./review-cli.ts";
import { galleryEntries } from "./src/review.ts";

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
