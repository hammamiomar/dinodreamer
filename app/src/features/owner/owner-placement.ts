// Where the owner's view may run. The Worker serves it only at its canonical lower-case path, after
// the owner check, with frame-ancestors 'none' (gallery/src/admin.ts). The app's router matches a
// path without regard to case and after percent-decoding, and the static assets answer any other
// spelling, such as /ADMIN/automata, with the same app and without that header. So the view itself
// refuses to run inside a frame, and a document that the server delivered for another path reloads at
// the canonical one, where the Worker's checks apply.

/** The paths the Worker serves the owner's view at (gallery/src/admin.ts OWNER_APP_PAGE). */
const OWNER_DOCUMENT_PATH = /^\/admin\/automata(?:\/basis\/\d{1,5})?$/;

export type OwnerPlacement = { kind: "run" } | { kind: "framed" } | { kind: "reload"; to: string };

/**
 * What the owner's view does: refuse when another page frames it; run when the document is the one the
 * Worker served for the owner's path; else reload at the canonical spelling of the route's path (or the
 * view's own address), keeping the query.
 */
export function ownerPlacement(placed: { framed: boolean; documentPath: string; routePath: string; search: string }): OwnerPlacement {
  if (placed.framed) return { kind: "framed" };
  if (OWNER_DOCUMENT_PATH.test(placed.documentPath)) return { kind: "run" };
  let route: string;
  try {
    route = decodeURIComponent(placed.routePath).toLowerCase();
  } catch {
    route = "";
  }
  return { kind: "reload", to: `${OWNER_DOCUMENT_PATH.test(route) ? route : "/admin/automata"}${placed.search}` };
}
