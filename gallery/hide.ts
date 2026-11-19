// Take a published entry out of the gallery and keep its objects: pnpm run hide <id>

import { idArgument, openBuckets, terminalText } from "./review-cli.ts";
import { hide } from "./src/review.ts";

const id = idArgument("hide");
const { submissions, library } = openBuckets();
const hidden = await hide(submissions, library, id, new Date());
console.log(`Hid ${hidden.id} "${terminalText(hidden.title)}". A gallery loaded after its 60 s cache does not list it; pnpm run restore ${id} brings it back.`);
