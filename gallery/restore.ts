// Put a hidden entry back into the gallery at its original place: pnpm run restore <id>

import { idArgument, openBuckets } from "./review-cli.ts";
import { restore } from "./src/review.ts";

const id = idArgument("restore");
const { submissions, library } = openBuckets();
const entry = await restore(submissions, library, id);
console.log(`Restored ${entry.id} "${entry.title}", published ${entry.publishedAt}`);
