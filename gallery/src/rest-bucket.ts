// The Bucket interface over the Cloudflare R2 REST API, for the owner's terminal scripts.
// It uses wrangler's own login (`wrangler auth token`), so the scripts need no extra secret.
// Writes send Content-Type and Cache-Control as request headers, as `wrangler r2 object put` does.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Bucket, HttpMetadata, StoredObject } from "./storage.ts";

export const ACCOUNT_ID = "ca9d38a784a1dbc033775ecfd6551682";
const API = "https://api.cloudflare.com/client/v4";
const PAGE = 1000;

export function wranglerToken(galleryDirectory: string): string {
  const output = execFileSync(join(galleryDirectory, "node_modules", ".bin", "wrangler"), ["auth", "token", "--json"], {
    cwd: galleryDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return (JSON.parse(output) as { token: string }).token;
}

/** Attempts of one request that meets the API's rate limit (429) or a server error (5xx). */
const ATTEMPTS = 6;
const retryDelayMs = (attempt: number) => Math.min(60_000, 2_000 * 2 ** attempt);

export class RestBucket implements Bucket {
  private readonly base: string;
  private token: string;
  /** Gives a fresh token when the API refuses this one (401); absent for a fixed token. */
  private readonly renew: (() => string) | null;
  private readonly fetcher: typeof fetch;
  private readonly delayMs: (attempt: number) => number;

  /**
   * `token` is a token, or a function that gives one: wrangler's login lasts about an hour from its last
   * refresh, so a long run outlives the token it started with. With a function, a refused request (401)
   * takes a fresh token once and is sent again.
   */
  constructor(bucket: string, token: string | (() => string), fetcher: typeof fetch = fetch, delayMs = retryDelayMs) {
    this.base = `${API}/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects`;
    this.renew = typeof token === "function" ? token : null;
    this.token = typeof token === "function" ? token() : token;
    this.fetcher = fetcher;
    this.delayMs = delayMs;
  }

  /**
   * Retry rate limits and server errors with backoff. Every request here is idempotent:
   * a GET, a PUT of the whole object, a DELETE or a LIST.
   */
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let renewed = false;
    for (let attempt = 1; ; attempt++) {
      const headers = { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${this.token}` };
      const response = await this.fetcher(`${this.base}${path}`, { ...init, headers });
      if (response.status === 401 && this.renew && !renewed) {
        renewed = true;
        this.token = this.renew();
        attempt--;
        continue;
      }
      if ((response.status !== 429 && response.status < 500) || attempt === ATTEMPTS) return response;
      await new Promise((resolve) => setTimeout(resolve, this.delayMs(attempt)));
    }
  }

  private objectPath(key: string): string {
    return `/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.request(this.objectPath(key));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET ${key}: HTTP ${response.status}`);
    const body = await response.arrayBuffer();
    return { arrayBuffer: async () => body, text: async () => new TextDecoder().decode(body) };
  }

  async put(key: string, body: ArrayBuffer | Uint8Array | string, options: { httpMetadata?: HttpMetadata } = {}): Promise<void> {
    const headers: Record<string, string> = {};
    if (options.httpMetadata?.contentType) headers["content-type"] = options.httpMetadata.contentType;
    if (options.httpMetadata?.cacheControl) headers["cache-control"] = options.httpMetadata.cacheControl;
    const payload = typeof body === "string" || body instanceof ArrayBuffer ? body : new Uint8Array(body);
    const response = await this.request(this.objectPath(key), { method: "PUT", body: payload, headers });
    if (!response.ok) throw new Error(`PUT ${key}: HTTP ${response.status} ${await response.text()}`);
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const response = await this.request(this.objectPath(key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error(`DELETE ${key}: HTTP ${response.status}`);
    }
  }

  async list(options: { prefix: string; cursor?: string }) {
    const query = new URLSearchParams({ prefix: options.prefix, per_page: String(PAGE) });
    if (options.cursor) query.set("cursor", options.cursor);
    const response = await this.request(`?${query}`);
    if (!response.ok) throw new Error(`LIST ${options.prefix}: HTTP ${response.status}`);
    const page = (await response.json()) as {
      result: { key: string; size: number; etag: string }[];
      result_info?: { cursor?: string; is_truncated?: boolean };
    };
    const truncated = page.result_info?.is_truncated === true;
    // The etag of an object written in one PUT is the MD5 of its body (publish-library-folder.ts compares it).
    const objects = page.result.map((object) => ({ key: object.key, size: object.size, etag: object.etag }));
    return truncated && page.result_info?.cursor ? { objects, truncated, cursor: page.result_info.cursor } : { objects, truncated: false };
  }
}
