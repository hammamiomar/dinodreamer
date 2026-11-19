# Cloudflare settings

`deploy.ts` deploys the Worker with `wrangler.jsonc`: its routes, Static Assets, bindings and rate-limit binding.
Every other setting below is made in the Cloudflare dashboard, and no code deploys it. When you change one
of these settings, change this page in the same change.

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
| library release manifest | `(http.host eq "library.computervision.vision" and starts_with(http.request.uri.path, "/releases/") and ends_with(http.request.uri.path, ".json"))` | Eligible for cache. Edge TTL 2 hours, ignoring `Cache-Control` (the Free plan's minimum). Browser TTL respects the origin, so browsers receive the object's `no-cache`. |
| library automata versions | `(http.host eq "library.computervision.vision" and http.request.uri.query eq "" and (http.request.uri.path strict wildcard "/gallery/materials/*/versions/*/material.json" or http.request.uri.path strict wildcard "/gallery/materials/*/versions/*/poster.png"))` | Eligible for cache. Edge TTL from `Cache-Control` when present, otherwise bypass. Browser TTL respects the origin. Default cache key. Placed after any general library bypass rule (`material-delivery.md`). |
| full clouds (older rule) | `(http.host eq "library.computervision.vision" and starts_with(http.request.uri.path, "/web/v2/readouts/5e2791a38795e8cc07b301307d137224d40d12a318547a038e49003ac29ed139/clouds/full/") and ends_with(http.request.uri.path, ".bin"))` | Not cached. The action is not recorded; the responses are `DYNAMIC`. |

The automata versions rule may have been entered in this equivalent form. It matches the same keys that
the publisher writes, `/gallery/materials/<entry-id>/versions/<fileRevision>/material.json` and `poster.png`:

```text
(http.host eq "library.computervision.vision" and http.request.uri.query eq "" and
 starts_with(http.request.uri.path, "/gallery/materials/") and contains(http.request.uri.path, "/versions/") and
 (ends_with(http.request.uri.path, "/material.json") or ends_with(http.request.uri.path, "/poster.png")))
```

Without a Cache Rule, Cloudflare does not cache JSON, `.wasm` or `.safetensors` files. Every key under
`/web/v2/`, `/model/` and `/app/` names its content, and its object says `immutable`, so the edge may keep it.
So does every versioned automaton file. The stable aliases under `/gallery/materials/<entry-id>/` stay outside
the rules because a new reading replaces them.

### Security rules

The zone also has WAF and rate-limiting rules managed in the Cloudflare dashboard. They are not published here.

## R2 bucket `dinodreamer-library`

| Setting | Value |
| --- | --- |
| Custom domain | `library.computervision.vision`, minimum TLS 1.2 |
| CORS | Anonymous `GET` and `HEAD` from any origin. It exposes `ETag`, `Age`, and `CF-Cache-Status`. |
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

After a release manifest is rewritten, purge the edge cache immediately:

1. Open Cloudflare dashboard > computervision.vision > Caching > Configuration > Custom Purge.
2. Purge by Prefix: `library.computervision.vision/releases/<release>.json`.

Use the prefix purge, not a purge by URL. The edge keeps one copy for each `Origin` header. A purge by URL
leaves the copies that the app's CORS requests made (`src/cdn-check.ts`). The next page load then reads
the new manifest. Without the purge, a visitor can read the old manifest for up to 2 hours.

## Checks on 19 November 2026

| Request | Answer |
| --- | --- |
| An encoder file, a group cloud JSON and the engine, twice | `MISS`, then `HIT` |
| `releases/pass-003.json`, after its browser TTL was set to respect the origin | `HIT`, `Cache-Control: no-cache` |
| A versioned automaton's `material.json` and `poster.png`, twice | `MISS`, then `HIT` |
| `clouds/full/4009.bin` | `DYNAMIC` |

One answer differs from the intended settings:

- **The full clouds stay uncached.** The older rule still takes effect for them, so each basis-group
  panel makes 8 Range requests to R2. Before you remove it, test one uncached file: a Range request, then a
  whole-file GET. Both must return the same bytes (206 and 200), and a repeat must answer `HIT`.
