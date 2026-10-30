// An in-memory Bucket with R2's list paging, for tests of the Worker and the review commands.

import type { Bucket, HttpMetadata, StoredObject } from "../src/storage.ts";

export interface MemoryObject {
  body: Uint8Array;
  httpMetadata: HttpMetadata;
}

export class MemoryBucket implements Bucket {
  readonly objects = new Map<string, MemoryObject>();
  private readonly pageSize: number;

  constructor(pageSize = 2) {
    this.pageSize = pageSize;
  }

  async get(key: string): Promise<StoredObject | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return null;
    const body = stored.body.slice();
    return { arrayBuffer: async () => body.buffer, text: async () => new TextDecoder().decode(body) };
  }

  async put(key: string, body: ArrayBuffer | Uint8Array | string, options: { httpMetadata?: HttpMetadata } = {}) {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, { body: bytes.slice(), httpMetadata: options.httpMetadata ?? {} });
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list(options: { prefix: string; cursor?: string }) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
    const start = Number(options.cursor ?? 0);
    const page = keys.slice(start, start + this.pageSize).map((key) => ({ key }));
    const next = start + page.length;
    return next < keys.length ? { objects: page, truncated: true, cursor: String(next) } : { objects: page, truncated: false };
  }

  keys(prefix = ""): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}
