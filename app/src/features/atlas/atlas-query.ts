/** True when a search names any Atlas position: an old link to the Atlas at /. */
export function hasAtlasQuery(search: URLSearchParams): boolean {
  return ["role", "sort", "page"].some((key) => search.has(key));
}
