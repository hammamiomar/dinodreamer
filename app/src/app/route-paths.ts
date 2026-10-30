/** Canonical page paths. Query fields and saved identifiers keep their existing names. */
const RENAMED_PAGES = [
  ["/explore", "/index"],
  ["/block", "/basis"],
  ["/playground", "/automata"],
  ["/grow", "/train"],
] as const;

const PANEL_PATH = /^\/(index|automata|train|picture|how|create|admin\/materials)\/block(?=\/|$)/;

/** Translate an old page or panel path without changing API paths or partial name matches. */
export function canonicalPathname(pathname: string): string {
  let canonical = pathname;
  for (const [previous, current] of RENAMED_PAGES) {
    if (pathname === previous || pathname.startsWith(`${previous}/`)) {
      canonical = current + pathname.slice(previous.length);
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
  "/admin/materials/block/:id",
] as const;
