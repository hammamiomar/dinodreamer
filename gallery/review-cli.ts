// Shared CLI utilities: R2 bucket connections, library base URL lookup, y/N confirmation,
// and terminal-safe escaping for visitor text.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { RestBucket, wranglerToken } from "./src/rest-bucket.ts";
import { PUBLIC_BUCKET, SUBMISSIONS_BUCKET, type Bucket } from "./src/storage.ts";
import { escapedText } from "../app/src/visitor-text.ts";

/** Read the public library CDN origin from app/.env (without a trailing slash). */
export function libraryCdnBaseUrl(envFile: URL | string = new URL("../app/.env", import.meta.url)): string {
  const env = readFileSync(envFile, "utf8");
  const match = env.match(/^ASSET_BASE_URL=(https:\/\/\S+)$/m);
  if (!match?.[1]) throw new Error("app/.env must name the public HTTPS library in ASSET_BASE_URL");
  return match[1].replace(/\/$/, "");
}

/** Open the Cloudflare R2 buckets using wrangler's login, renewing tokens if a long run expires. */
export function openBuckets(): { submissions: RestBucket; library: RestBucket } {
  const token = () => wranglerToken(import.meta.dirname);
  return { submissions: new RestBucket(SUBMISSIONS_BUCKET, token), library: new RestBucket(PUBLIC_BUCKET, token) };
}

/**
 * Open the local Worker's persisted buckets (`wrangler dev --local --persist-to <dir>`)
 * so CLI commands and the local owner view operate on the same objects without reaching Cloudflare.
 */
export async function openLocalBuckets(persistTo: string): Promise<{ submissions: Bucket; library: Bucket; close(): Promise<void> }> {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ SUBMISSIONS: Bucket; LIBRARY: Bucket }>({ persist: { path: `${persistTo}/v3` } });
  return { submissions: proxy.env.SUBMISSIONS, library: proxy.env.LIBRARY, close: () => proxy.dispose() };
}

/** Return true only when the owner types y or yes. */
export async function confirmed(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await terminal.question(`${question} [y/N] `);
  terminal.close();
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * Escape control characters and line separators before printing visitor text in the terminal.
 * Submissions reject unsafe characters at upload time; escaping here protects against older records.
 */
export function terminalText(text: string): string {
  return escapedText(text);
}
