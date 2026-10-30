// When the synthesis worker starts. Its module and the model behind it are the
// largest things the app loads, so a visitor who only reads the landing or
// browses the Index never fetches them. Once started it stays, so a run continues
// while the visitor browses (editor-session.tsx latches this rule).

/**
 * True when a creation needs an engine: on Create, when the creation has a
 * request.
 */
export function engineWanted(pathname: string, requestCount: number): boolean {
  return pathname === "/create" || pathname.startsWith("/create/") || requestCount > 0;
}
