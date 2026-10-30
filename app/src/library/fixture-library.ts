// Tests only: the fixture release in app/fixtures/ served as if it were the bucket.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openLibrary } from "./library";
import type { Library } from "./library";
import { decodeProvenancePage } from "./records";
import type { AtlasPage } from "./records";
import type { LibraryRole } from "./roles";

const FIXTURES = join(import.meta.dirname, "../../fixtures");
export const FIXTURE_BASE = "https://assets.test";

/** A fetch that reads app/fixtures/ and counts requests per URL. */
export function fixtureFetch() {
  const requests = new Map<string, number>();
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.set(url, (requests.get(url) ?? 0) + 1);
    try {
      return new Response(await readFile(join(FIXTURES, url.slice(FIXTURE_BASE.length))));
    } catch {
      return new Response("missing", { status: 404 });
    }
  };
  return { fetcher: fetcher as typeof fetch, requests };
}

export async function fixtureLibrary() {
  const { fetcher, requests } = fixtureFetch();
  return { library: await openLibrary({ baseUrl: FIXTURE_BASE, release: "fixture" }, fetcher), requests };
}

/** Page 0 of a provenance order of the fixture table, decoded as the Atlas decodes a provenance page. */
export async function fixtureProvenancePage(library: Library, role: LibraryRole, order: string): Promise<AtlasPage> {
  const prefix = library.release.provenance!.prefix.replace(/\/?$/, "/");
  const file = await readFile(join(FIXTURES, prefix, `atlas/${role}/${order}/0.json`), "utf8");
  return decodeProvenancePage(JSON.parse(file), order);
}
