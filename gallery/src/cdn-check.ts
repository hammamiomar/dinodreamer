// After a purge: what the library CDN answers for an entry's public objects, as seen from
// this machine. The edge keeps one copy per Origin, so each object is asked for without an
// Origin and with the app's. One machine reaches one edge: a 404 here says nothing about
// other edges, so the owner's manual cache purge is always needed, whatever this check sees.

/** The app's own origin: the app loads bucket objects with CORS. */
import { DINODREAMER_ORIGIN as APP_ORIGIN } from "./site-location.ts";
export { APP_ORIGIN };

export type CopyState = "served" | "absent here" | "unknown";

export interface CopyCheck {
  url: string;
  origin?: string;
  state: CopyState;
  /** HTTP status, cf-cache-status and the edge's airport code from cf-ray, or the network error. */
  detail: string;
}

/**
 * Where the owner purges an entry's cached copies by hand: wrangler's login cannot purge the
 * cache. Cloudflare's docs say a purge by URL leaves the copies cached with an Origin header,
 * so the step is the purge by prefix (README: CDN cache). The curl checks show what remains.
 */
export const PURGE_BY_PREFIX_PLACE = "Cloudflare dashboard > computervision.vision > Caching > Configuration > Custom Purge > Purge by Prefix";

/** The dashboard's Custom Purge by Prefix value for an entry: host and path, without the scheme. */
export function purgePrefix(assetBaseUrl: string, id: string): string {
  return `${new URL(assetBaseUrl).host}/gallery/${id}/`;
}

/** One prefix covers every reading and its stable aliases. Earlier link-preview recordings have their own prefix. */
export function materialCdnPurge(assetBaseUrl: string, id: string) {
  const host = new URL(assetBaseUrl).host;
  return { place: PURGE_BY_PREFIX_PLACE, prefixes: [`${host}/gallery/materials/${id}/`, `${host}/previews/${id}/`] };
}

/** The command that asks the CDN for one copy again; after the purge it must print 404. */
export function curlCommand(url: string, origin?: string): string {
  const originOption = origin === undefined ? "" : ` -H 'origin: ${origin}'`;
  return `curl -s -o /dev/null -w '%{http_code}\\n'${originOption} ${url}`;
}

export async function checkCopies(urls: string[], fetcher: typeof fetch = fetch): Promise<CopyCheck[]> {
  const checks: CopyCheck[] = [];
  for (const url of urls) {
    for (const origin of [undefined, APP_ORIGIN]) {
      const headers: Record<string, string> = { "user-agent": "dinodreamer-gallery-purge" };
      if (origin !== undefined) headers.origin = origin;
      const check: CopyCheck = origin === undefined ? { url, state: "unknown", detail: "" } : { url, origin, state: "unknown", detail: "" };
      try {
        const response = await fetcher(url, { headers });
        await response.body?.cancel();
        if (response.status === 200) check.state = "served";
        if (response.status === 404) check.state = "absent here";
        const edge = response.headers.get("cf-ray")?.split("-").pop() ?? "?";
        check.detail = `HTTP ${response.status}, cf-cache-status ${response.headers.get("cf-cache-status") ?? "none"}, edge ${edge}`;
      } catch (error) {
        check.detail = `no answer: ${error instanceof Error ? error.message : String(error)}`;
      }
      checks.push(check);
    }
  }
  return checks;
}
