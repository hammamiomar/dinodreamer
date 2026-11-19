// Shared start-up of the owner's commands: the two buckets, opened with wrangler's login,
// the id argument, the y/N question before a command that cannot be undone, and the one way
// they print a visitor's text.

import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { RestBucket, wranglerToken } from "./src/rest-bucket.ts";
import { PUBLIC_BUCKET, SUBMISSIONS_BUCKET, type Bucket } from "./src/storage.ts";
import { escapedText } from "../app/src/visitor-text.ts";

/** Cloudflare's two buckets, with wrangler's login, renewed when a long run outlives it (rest-bucket.ts). */
export function openBuckets(): { submissions: RestBucket; library: RestBucket } {
  const token = () => wranglerToken(dirname(fileURLToPath(import.meta.url)));
  return { submissions: new RestBucket(SUBMISSIONS_BUCKET, token), library: new RestBucket(PUBLIC_BUCKET, token) };
}

/**
 * The local Worker's two buckets, as `wrangler dev --local --persist-to <dir>` keeps them: the
 * terminal and the local owner page then act on the same objects, and nothing reaches Cloudflare.
 */
export async function openLocalBuckets(persistTo: string): Promise<{ submissions: Bucket; library: Bucket; close(): Promise<void> }> {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ SUBMISSIONS: Bucket; LIBRARY: Bucket }>({ persist: { path: `${persistTo}/v3` } });
  return { submissions: proxy.env.SUBMISSIONS, library: proxy.env.LIBRARY, close: () => proxy.dispose() };
}

export function idArgument(command: string): string {
  const id = process.argv[2];
  if (id === undefined) {
    console.error(`usage: pnpm run ${command} <submission id>   (list the entries with: pnpm run list)`);
    process.exit(2);
  }
  return id;
}

/** True only when the owner types y or yes. */
export async function confirmed(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await terminal.question(`${question} [y/N] `);
  terminal.close();
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * A stored visitor text (title, credit, a file's own id) as the owner's terminal prints it: a control
 * character or line separator shows as its \uXXXX escape and does nothing. The submission boundary
 * refuses them; this keeps an older record or another writer's from acting on the terminal.
 */
export function terminalText(text: string): string {
  return escapedText(text);
}
