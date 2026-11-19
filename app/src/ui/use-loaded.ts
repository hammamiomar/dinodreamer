// A value loaded once per key, for views that read the library outside a route loader.

import { useEffect, useRef, useState } from "react";

export type Loaded<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "failed"; message: string }
  /** `load` returned or resolved to null: there is nothing to load (for example, the release lacks the file). */
  | { status: "absent" };

/**
 * Runs `load` when `key` changes and reports its result. A result that arrives
 * after the key changed is dropped, so a fast click through pictures never shows
 * an older picture's data.
 */
export function useLoaded<T>(key: unknown, load: () => Promise<T | null> | null): Loaded<T> {
  const [loaded, setLoaded] = useState<{ key: unknown; state: Loaded<T> }>({ key, state: { status: "loading" } });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let current = true;
    setLoaded({ key, state: { status: "loading" } });
    Promise.resolve().then(() => loadRef.current()).then(
      (value) => current && setLoaded({ key, state: value === null ? { status: "absent" } : { status: "ready", value } }),
      (error: unknown) => current && setLoaded({ key, state: { status: "failed", message: error instanceof Error ? error.message : String(error) } }),
    );
    return () => {
      current = false;
    };
  }, [key]);
  return loaded.key === key ? loaded.state : { status: "loading" };
}
