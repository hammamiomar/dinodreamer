/** Canonical page paths. Query fields and saved identifiers keep their existing names. */
const RENAMED_PAGES = [
  ["/explore", "/index"],
  ["/block", "/basis"],
  ["/playground", "/automata"],
  ["/grow", "/train"],
] as const;

const PANEL_PATH = /^\/(index|automata|train|picture|how|create|admin\/materials)\/block(?=\/|$)/;

/**
 * The owner's pages answer only at the lower-case, unencoded /admin, where the Worker checks the owner
 * and forbids framing (gallery/src/admin.ts). The app's router matches a path without regard to case
 * and after percent-decoding, so /ADMIN/automata or /%61dmin/automata names the same view: such a
 * first segment is spelled as the Worker serves it.
 */
function canonicalOwnerSegment(pathname: string): string {
  const slash = pathname.indexOf("/", 1);
  const first = slash === -1 ? pathname.slice(1) : pathname.slice(1, slash);
  let decoded: string;
  try {
    decoded = decodeURIComponent(first);
  } catch {
    return pathname;
  }
  if (!/^admin(?:\/|$)/i.test(decoded)) return pathname;
  return `/admin${decoded.slice("admin".length)}${slash === -1 ? "" : pathname.slice(slash)}`;
}

/** Translate an old page or panel path, and another spelling of /admin, without changing API paths or partial name matches. */
export function canonicalPathname(pathname: string): string {
  let canonical = canonicalOwnerSegment(pathname);
  for (const [previous, current] of RENAMED_PAGES) {
    if (canonical === previous || canonical.startsWith(`${previous}/`)) {
      canonical = current + canonical.slice(previous.length);
      break;
    }
  }
  return canonical.replace(PANEL_PATH, "/$1/basis");
}

/** Client aliases also cover direct visits to the local development server. */
export const LEGACY_PAGE_PATHS = [
  "/explore/*",
  "/block/*",
  "/playground/*",
  "/grow/*",
  "/index/block/:id",
  "/automata/block/:id",
  "/train/block/:id",
  "/picture/block/:id",
  "/how/block/:id",
  "/create/block/:id",
] as const;
