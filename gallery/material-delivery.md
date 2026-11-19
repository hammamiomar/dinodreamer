# Published automaton delivery

The public index at `/api/materials` names each published automaton. A versioned record has a `fileRevision` field. Its value is the SHA-256 digest of the stored definition bytes, which include the poster. The browser reads both files directly from the library.

```text
/gallery/materials/<entry-id>/versions/<fileRevision>/material.json
/gallery/materials/<entry-id>/versions/<fileRevision>/poster.png
```

A new reading at the same training step can change the digest. Each version keeps its own address until the owner purges the automaton. Existing site links under `/api/materials/<entry-id>/` still open the current files. A loopback development site reads its local bucket through the Worker.

## Configure the library cache

In the `computervision.vision` zone, create a Cache Rule for the versioned objects. Put it after any general library bypass rule. Use this custom expression.

```text
(http.host eq "library.computervision.vision" and
 http.request.uri.query eq "" and
 (http.request.uri.path strict wildcard "/gallery/materials/*/versions/*/material.json" or
  http.request.uri.path strict wildcard "/gallery/materials/*/versions/*/poster.png"))
```

- Set **Cache eligibility** to **Eligible for cache**.
- For **Edge TTL**, use the origin Cache-Control header when present and bypass the cache when absent.
- For **Browser TTL**, select **Respect origin**. Keep the default cache key.

The publisher sets `public, max-age=31536000, immutable` on the versioned objects. The mutable aliases are outside the rule. The existing rule that blocks library query strings can remain active. [Cloudflare Cache Rule settings](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/) · [Rule expression operators](https://developers.cloudflare.com/ruleset-engine/rules-language/operators/)

## Activate existing automata

Release the new Worker and app before the migration. Existing records use the compatible site endpoints until they acquire a revision. Use the updated owner tools for later publication and re-reads.

From `gallery/`, run `pnpm run materials version-files` for the count. Run `pnpm run materials version-files --write` to copy the files and update the records. Schedule the write between owner operations that change the gallery. Visitors can continue reading. The index and owner records use ordinary bucket writes without a conditional update.

The command copies each existing definition and poster byte for byte. It checks that the definition embeds the same PNG. It preserves the labels, publication times, owner marks and hidden state. If the command reports a mismatch, inspect the named pair before retrying. After an interruption, run the same command again. A final count of zero shown and zero hidden records means every listed record has a revision.

## Visibility and removal

The public Worker caches the materials index at each active location. Its response carries an absolute expiry one minute after the bucket read. A browser that receives a cached copy uses that same deadline. The owner API reads the current bucket records directly.

Hide removes an entry from the index and keeps the files available to existing links. Purge removes all file versions, the stable aliases and any earlier preview recording. After a production purge, the owner page and the terminal name the prefixes to clear in Cloudflare. Use **Purge by Prefix** on both `library.computervision.vision/gallery/materials/<entry-id>/` and `library.computervision.vision/previews/<entry-id>/`. This clears edge copies for all revisions. A visitor can retain bytes already downloaded. [Cloudflare purge by prefix](https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/)
