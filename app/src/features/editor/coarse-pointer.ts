// Whether the visitor points with a finger. Most phone browsers cannot drag and drop
// between pages and a finger has no right button, so the editor offers the path that
// works: tapping a token in the block viewer, and the eraser toggle.

import { useEffect, useState } from "react";

const COARSE_POINTER = "(pointer: coarse)";

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia(COARSE_POINTER).matches);
  useEffect(() => {
    const media = window.matchMedia(COARSE_POINTER);
    const update = () => setCoarse(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return coarse;
}
