// The owner's names for the basis groups, read once per page load from the gallery Worker
// (GET /api/basis-groups) and shared by the wall and a group's screen. A name is an addition: while
// the names load, and when they cannot be read, a group shows its number alone.

import { useEffect, useState } from "react";
import { NO_NAMES, readBasisGroupNames, type BasisGroupNames } from "../gallery/basis-groups";

let shared: Promise<BasisGroupNames> | undefined;
const listeners = new Set<() => void>();

async function fetchNames(): Promise<BasisGroupNames> {
  const response = await fetch("/api/basis-groups");
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) return NO_NAMES;
  return readBasisGroupNames(await response.json());
}

/** Read the names again, after the owner changed one. */
export function refreshBasisGroupNames(): void {
  shared = undefined;
  listeners.forEach((listener) => listener());
}

export function useBasisGroupNames(): BasisGroupNames {
  const [names, setNames] = useState<BasisGroupNames>(NO_NAMES);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = () => setRevision((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  useEffect(() => {
    let current = true;
    shared ??= fetchNames().catch(() => NO_NAMES);
    void shared.then((read) => { if (current) setNames(read); });
    return () => { current = false; };
  }, [revision]);
  return names;
}
