// Where gallery objects live, and the one bucket interface the Worker and the terminal
// scripts share. A submission is pending, published, hidden or gone:
//
//   private bucket  pending/<id>/image.png, recipe.json, meta.json         (meta.json is written last)
//                   hidden/<id>.json                                       (the index entry of a hidden one)
//   public bucket   gallery/<id>/image.png, thumbnail.webp, recipe.json    (immutable once approved; kept while hidden)
//                   published/index.json                                   (shown entries only; rewritten by each change)

export const SUBMISSIONS_BUCKET = "dinodreamer-submissions";
/** Served at ASSET_BASE_URL; published entries hold URLs relative to it, so the host can change. */
export const PUBLIC_BUCKET = "dinodreamer-library";

export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
/** The published index changes with each approval; viewers see it within a minute. */
export const INDEX_MAX_AGE_SECONDS = 60;
export const CACHE_INDEX = `public, max-age=${INDEX_MAX_AGE_SECONDS}`;

export const INDEX_KEY = "published/index.json";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}
export const SUBMISSION_FILES = ["image.png", "recipe.json", "meta.json"] as const;
export type SubmissionFile = (typeof SUBMISSION_FILES)[number];

const SUBMISSION_ID = /^\d{8}-\d{6}-[0-9a-f]{8}$/;

/** A sortable, unguessable name: UTC date and time, then 32 random bits. */
export function submissionId(now: Date, random: Uint8Array): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const suffix = Array.from(random.slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${stamp}-${suffix}`;
}

export function isSubmissionId(id: string): boolean {
  return SUBMISSION_ID.test(id);
}

/** pending/<id>/meta.json, written after the image and the recipe. */
export interface SubmissionMetadata {
  id: string;
  title: string;
  credit: string;
  release: string;
  submittedAt: string;
  /** The engine build that made the image (submission.ts); absent when the form sent none. */
  engine?: string;
}

export function pendingKey(id: string, file: SubmissionFile): string {
  return `pending/${id}/${file}`;
}

/** The engine's .wasm on the public bucket: immutable, so its path names its content. */
export function engineWasmKey(sha256: string, name: string): string {
  return `app/${sha256.slice(0, 16)}/${name}`;
}

/** A hidden entry's index entry, kept privately so that restore can put it back. */
export function hiddenKey(id: string): string {
  return `hidden/${id}.json`;
}

export const PUBLISHED_FILES = ["image.png", "thumbnail.webp", "recipe.json"] as const;
export type PublishedFile = (typeof PUBLISHED_FILES)[number];

export function publishedKey(id: string, file: PublishedFile): string {
  return `gallery/${id}/${file}`;
}

export interface HttpMetadata {
  contentType?: string;
  cacheControl?: string;
}

export interface StoredObject {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

/**
 * The subset of the Workers R2 binding this project uses. A Worker binding satisfies it
 * directly; the terminal scripts implement it over the Cloudflare REST API (rest-bucket.ts).
 */
export interface Bucket {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, body: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: HttpMetadata }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

export async function requiredObject(bucket: Bucket, key: string): Promise<StoredObject> {
  const stored = await bucket.get(key);
  if (stored === null) throw new Error(`${key} does not exist`);
  return stored;
}

/** Raised when an owner action cannot be applied to the current stored state. */
export class ConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConflictError";
  }
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listKeys(bucket: Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
}
