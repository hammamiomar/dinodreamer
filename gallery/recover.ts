// Rebuild a submission as the creation file the app imports: pnpm run recover <id> [directory]
// The file goes to <directory>/<id>.dinodreamer.json (default: the current directory).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { idArgument, openBuckets } from "./review-cli.ts";
import { recoverCreation } from "./src/review.ts";

const id = idArgument("recover");
const directory = process.argv[3] ?? ".";
const { submissions, library } = openBuckets();
const { title, text } = await recoverCreation(submissions, library, id);
const path = join(directory, `${id}.dinodreamer.json`);
writeFileSync(path, text);
console.log(`Wrote "${title}" to ${path}; import it on the app's Saved page`);
