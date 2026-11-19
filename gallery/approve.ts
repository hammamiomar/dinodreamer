// Publish pending submissions to the gallery: pnpm run approve <id>
// or, after a y/N question that shows them, every pending one: pnpm run approve --all

import { confirmed, idArgument, openBuckets, terminalText } from "./review-cli.ts";
import { approve, approveAll, pendingSubmissions } from "./src/review.ts";
import { sharpThumbnail } from "./src/thumbnail-sharp.ts";

if (process.argv[2] === "--all") {
  const { submissions, library } = openBuckets();
  const pending = await pendingSubmissions(submissions);
  if (pending.length === 0) {
    console.log("0 pending");
    process.exit(0);
  }
  for (const metadata of pending) console.log(`  ${metadata.id}  "${terminalText(metadata.title)}"  by "${terminalText(metadata.credit)}"`);
  if (!(await confirmed(`Publish these ${pending.length}?`))) {
    console.log("Nothing published");
    process.exit(1);
  }
  const ids = pending.map((metadata) => metadata.id);
  const entries = await approveAll(submissions, library, ids, new Date(), sharpThumbnail);
  console.log(`Published ${entries.length}: ${entries.map((entry) => entry.id).join(", ")}`);
} else {
  const id = idArgument("approve");
  const { submissions, library } = openBuckets();
  const entry = await approve(submissions, library, id, new Date(), sharpThumbnail);
  console.log(`Published ${entry.id} at <ASSET_BASE_URL>/${entry.imageUrl}, thumbnail ${entry.thumbnailUrl}`);
}
