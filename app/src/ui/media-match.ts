// A layout choice made in script from a media query, where a page's parts differ, not only its styles.

import { useEffect, useState } from "react";

/** Whether a media query matches now, following its changes. */
export function useMediaMatch(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
