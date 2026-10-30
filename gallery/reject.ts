// Delete one pending submission: pnpm reject <id>

import { idArgument, openBuckets } from "./review-cli.ts";
import { reject } from "./src/review.ts";

const id = idArgument("reject");
const { submissions } = openBuckets();
await reject(submissions, id);
console.log(`Deleted pending submission ${id}`);
