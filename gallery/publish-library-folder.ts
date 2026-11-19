// Publish one local folder of library files to the public library bucket, under the same keys. The local
// overlays the dev server reads (vite.config.ts: ATLAS_ASSETS, READER_ASSETS) and the link previews mirror
// the bucket below their *-assets root, so the keys are the path below that root: for example the Atlas
// clouds, <...>/atlas-assets/web/v2/readouts/<readout>/atlas-clouds, the dictionary reader,
// <...>/reader-assets/model/<dictionary>, and the link previews, <...>/preview-assets/previews. It
// writes with wrangler's login (src/rest-bucket.ts), as deploy.ts writes the engine.
//
//   pnpm run publish-library-folder <folder>             dry run: the files, their bytes, and what the bucket holds
//   pnpm run publish-library-folder <folder> --publish   upload what is missing; the folder's own JSON files last
//   pnpm run publish-library-folder <folder> --verify    sampled read-back over the public URL
//
// The objects are immutable, like every versioned release path: a key that exists with the same size
// and MD5 is skipped, so a stopped upload resumes; a key that exists with other bytes stops the run,
// because the CDN may already hold the old bytes for a year.

import { createHash, randomInt } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { libraryCdnBaseUrl } from "./review-cli.ts";
import { RestBucket, wranglerToken } from "./src/rest-bucket.ts";
import { CACHE_IMMUTABLE, PUBLIC_BUCKET, type Bucket } from "./src/storage.ts";

// Content types for file extensions stored in the public library bucket.
const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json", ".bin": "application/octet-stream", ".safetensors": "application/octet-stream",
  ".png": "image/png", ".mp4": "video/mp4",
};
/** The Cloudflare API allows 1,200 requests per 5 minutes per user; stay under it with room for the listing. */
const REQUESTS_PER_5_MINUTES = 1100;
const CONCURRENT_UPLOADS = 4;
const VERIFY_SAMPLE = 20;

export interface LocalFile { key: string; path: string; size: number; md5: string; contentType: string }

function localFiles(root: string, prefix: string): LocalFile[] {
  const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  return walk(root).map((path) => {
    const name = relative(root, path);
    const contentType = CONTENT_TYPES[name.slice(name.lastIndexOf("."))];
    if (!contentType) throw new Error(`${name} has no content type in the library layout`);
    const body = readFileSync(path);
    return { key: `${prefix}/${name}`, path, size: body.length, md5: createHash("md5").update(body).digest("hex"), contentType };
  });
}

async function storedObjects(bucket: RestBucket, prefix: string): Promise<Map<string, { size: number; etag: string }>> {
  const stored = new Map<string, { size: number; etag: string }>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `${prefix}/`, cursor });
    for (const object of page.objects) stored.set(object.key, { size: object.size, etag: object.etag.replaceAll('"', "") });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return stored;
}

/** Same bytes, different bytes, or absent; a different object stops the publish. */
function plan(files: LocalFile[], stored: Map<string, { size: number; etag: string }>) {
  const missing: LocalFile[] = [];
  const different: string[] = [];
  let present = 0;
  for (const file of files) {
    const object = stored.get(file.key);
    if (!object) missing.push(file);
    else if (object.size === file.size && object.etag === file.md5) present++;
    else different.push(file.key);
  }
  return { missing, different, present };
}

/** Publish data first; no root manifest is visible until all data uploads succeed. */
export async function publish(bucket: Pick<Bucket, "put">, files: LocalFile[], prefix: string): Promise<void> {
  const spacing = 300_000 / REQUESTS_PER_5_MINUTES;
  const started = Date.now();
  let done = 0;
  let nextStart = Date.now();
  const upload = async (batch: LocalFile[]) => {
    let next = 0;
    let failed = false;
    const worker = async () => {
      try {
        while (!failed && next < batch.length) {
          const file = batch[next++]!;
          const wait = nextStart - Date.now();
          nextStart = Math.max(nextStart, Date.now()) + spacing;
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          if (failed) return;
          // RestBucket retries rate limits and server errors.
          await bucket.put(file.key, readFileSync(file.path), { httpMetadata: { contentType: file.contentType, cacheControl: CACHE_IMMUTABLE } });
          done++;
          if (done % 500 === 0 || done === files.length) {
            const seconds = (Date.now() - started) / 1000;
            console.log(`${done}/${files.length} uploaded, ${(done / seconds).toFixed(1)} per s, about ${Math.round((files.length - done) / (done / seconds) / 60)} min left`);
          }
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    };
    const results = await Promise.allSettled(Array.from({ length: CONCURRENT_UPLOADS }, worker));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  };
  const isManifest = (file: LocalFile) => !file.key.slice(prefix.length + 1).includes("/") && file.key.endsWith(".json");
  await upload(files.filter((file) => !isManifest(file)));
  await upload(files.filter(isManifest));
}

/**
 * Over the public URL: every file at the folder's root, then twenty random files below it (or all of
 * them when there are fewer): status, bytes, content type and cache header.
 */
async function verify(files: LocalFile[], prefix: string): Promise<boolean> {
  const libraryUrl = libraryCdnBaseUrl();
  const byKey = new Map(files.map((file) => [file.key, file]));
  const atRoot = files.filter((file) => !file.key.slice(prefix.length + 1).includes("/"));
  const below = files.filter((file) => !atRoot.includes(file));
  const picked = below.length <= VERIFY_SAMPLE ? below : Array.from({ length: VERIFY_SAMPLE }, () => below[randomInt(below.length)]!);
  const sample = [...atRoot, ...picked].map((file) => file.key);
  let failures = 0;
  for (const key of sample) {
    const file = byKey.get(key)!;
    const response = await fetch(`${libraryUrl}/${key}`, { headers: { "user-agent": "dinodreamer-publish-library-folder" } });
    const bytes = (await response.arrayBuffer()).byteLength;
    const headers = [response.headers.get("content-type"), response.headers.get("cache-control")];
    const ok = response.status === 200 && bytes === file.size && headers[0] === file.contentType && headers[1] === CACHE_IMMUTABLE;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${key.slice(prefix.length + 1)}: HTTP ${response.status}, ${bytes} of ${file.size} bytes, ${headers.join("; ")}`);
  }
  console.log(`${sample.length - failures} of ${sample.length} sampled objects match the local files`);
  return failures === 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const folder = args.find((arg) => !arg.startsWith("--"));
  if (!folder) throw new Error("usage: pnpm run publish-library-folder <folder> [--publish | --verify]");
  const root = resolve(folder);
  // The bucket's top-level folders that these overlays fill: the readouts, the model, the link previews.
  const prefix = root.match(/[^/]+-assets\/((?:web|model)\/.+|previews(?:\/.+)?)$/)?.[1];
  if (!prefix) throw new Error(`${root} must lie below an *-assets root, under web/, model/ or previews/`);

  const files = localFiles(root, prefix);
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  console.log(`${files.length} files, ${(bytes / 1e6).toFixed(1)} MB, under ${PUBLIC_BUCKET}/${prefix}/`);
  if (args.includes("--verify")) {
    process.exitCode = (await verify(files, prefix)) ? 0 : 1;
  } else {
    const bucket = new RestBucket(PUBLIC_BUCKET, () => wranglerToken(import.meta.dirname));
    const { missing, different, present } = plan(files, await storedObjects(bucket, prefix));
    console.log(`The bucket holds ${present} of them already; ${missing.length} to upload; ${different.length} differ`);
    if (different.length) throw new Error(`These objects exist with other bytes; nothing was uploaded: ${different.slice(0, 5).join(", ")}`);
    if (args.includes("--publish") && missing.length) {
      await publish(bucket, missing, prefix);
      console.log("Published. Read back a sample with --verify.");
    } else if (!args.includes("--publish")) {
      console.log(`Dry run. About ${Math.ceil(missing.length / REQUESTS_PER_5_MINUTES * 5)} min at the API limit; add --publish to upload.`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await main();
