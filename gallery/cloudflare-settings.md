# Cloudflare settings

`deploy.ts` deploys the Worker with `wrangler.jsonc`: its routes, Static Assets, bindings and rate-limit binding.
Every other setting below is made in the Cloudflare dashboard, and no code deploys it. When you change one
of these settings, change this page in the same change.

Recorded on 19 November 2026, after the performance audit of that day. The checks are ordinary GET requests
from outside Cloudflare, made by the orchestrator and the audit.

## Account

| Setting | Value | Why |
| --- | --- | --- |
| Workers plan | Workers Paid | The Free plan stops every page after 100,000 Worker requests in a day: every page and every API request runs the Worker. |
| Budget alert | On | R2 has no spending cap. The alert reports an unusual bill. It does not stop traffic. |
| Workers spending limit | Off | A limit stops every Worker on the account, so the site goes down instead. It does not cover R2. |

## Zone `computervision.vision`

The zone is on the Free plan. The rules below apply to the whole zone unless an expression names a host.

| Setting | Value | Why |
| --- | --- | --- |
| Smart Tiered Cache | On | A data center that misses asks an upper-tier data center before R2. Fewer requests reach R2. |

### Cache Rules

| Name | Expression | Action |
| --- | --- | --- |
| library immutable | `(http.host eq "library.computervision.vision" and (starts_with(http.request.uri.path, "/web/v2/") or starts_with(http.request.uri.path, "/model/") or starts_with(http.request.uri.path, "/app/")))` | Eligible for cache. Edge TTL and browser TTL from the object's `Cache-Control`. |
| library release manifest | `(http.host eq "library.computervision.vision" and starts_with(http.request.uri.path, "/releases/") and ends_with(http.request.uri.path, ".json"))` | Eligible for cache. Edge TTL 2 hours, ignoring `Cache-Control` (the Free plan's minimum). |
| full clouds (older rule) | `(http.host eq "library.computervision.vision" and starts_with(http.request.uri.path, "/web/v2/readouts/5e2791a38795e8cc07b301307d137224d40d12a318547a038e49003ac29ed139/clouds/full/") and ends_with(http.request.uri.path, ".bin"))` | Not cached. The action is not recorded; the responses are `DYNAMIC`. |

Without a Cache Rule, Cloudflare does not cache JSON, `.wasm` or `.safetensors` files. Every key under
`/web/v2/`, `/model/` and `/app/` names its content, and its object says `immutable`, so the edge may keep it.

### Security rules

The zone also has WAF and rate-limiting rules. They are not published here. The owner keeps them with the
library's bucket notes in the research repository (`deploy/public/README.md`, "Bucket configuration").

## R2 bucket `dinodreamer-library`

| Setting | Value |
| --- | --- |
| Custom domain | `library.computervision.vision`, minimum TLS 1.2 |
| CORS | Anonymous `GET` and `HEAD` from any origin. It exposes `ETag`, `Age` and `CF-Cache-Status`. The research repository's `deploy/public/public-cors.json` holds the rule. |
| `robots.txt` | `library-robots.txt` in this folder. |

Upload `robots.txt` after you change `library-robots.txt`:

```sh
npx wrangler r2 object put dinodreamer-library/robots.txt --remote --file library-robots.txt \
  --content-type "text/plain; charset=utf-8" --cache-control "public, max-age=86400"
```

The site's own crawl policy is `app/public/robots.txt`. Static Assets serve it without the Worker.

## When a release manifest changes

`releases/<release>.json` is the one library key that is rewritten under its name. A new table, such as
the strongest blocks or the contributions, adds a field to it. The edge keeps the manifest for up to
2 hours. The app asks for it with `cache: "no-cache"`, so a browser always revalidates it with the edge.

After the research publisher rewrites a manifest, it prints this step. Do it at once:

1. Open Cloudflare dashboard > computervision.vision > Caching > Configuration > Custom Purge.
2. Purge by Prefix: `library.computervision.vision/releases/<release>.json`.

Use the prefix purge, not a purge by URL. The edge keeps one copy for each `Origin` header. A purge by URL
leaves the copies that the app's CORS requests made (`src/cdn-check.ts`). The next page load then reads
the new manifest. Without the purge, a visitor can read the old manifest for up to 2 hours.

## Checks on 19 November 2026

| Request | Answer |
| --- | --- |
| An encoder file, a group cloud JSON and the engine, twice | `MISS`, then `HIT` |
| `releases/pass-003.json` | `HIT`, `Cache-Control: max-age=14400` |
| `clouds/full/4009.bin` | `DYNAMIC` |

Two answers differ from the intended settings:

- **The manifest's browser lifetime.** Browsers receive `max-age=14400` (4 hours) instead of the object's
  `no-cache`. The likely cause is the zone's browser cache lifetime, which now applies because the
  manifest is cached. The app's `no-cache` requests still revalidate it. Another reader of the manifest can keep a copy for 4 hours.
  To restore `no-cache`, set the release manifest rule's browser TTL to the origin's `Cache-Control`,
  then check the header again.
- **The full clouds stay uncached.** The older rule still takes effect for them, so each basis-group
  panel makes 8 Range requests to R2. Before you remove it, test one uncached file: a Range request, then a
  whole-file GET. Both must return the same bytes (206 and 200), and a repeat must answer `HIT`.
