// The owner's view as the router mounts it: the placement rule first (owner-placement.ts), then the page.

import { useEffect } from "react";
import { useLocation } from "react-router";
import { SITE_WORDS } from "../../app/site-words";
import { OwnerAutomataPage } from "./owner-automata-page";
import { ownerPlacement } from "./owner-placement";

const WORDS = SITE_WORDS.automataOwner;

/** The path this document was delivered for: after a client navigation, location shows another one. */
function documentPath(): string {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return new URL(navigation?.name ?? window.location.href).pathname;
}

export function OwnerAutomataRoute() {
  const { pathname, search } = useLocation();
  const placement = ownerPlacement({ framed: window.self !== window.top, documentPath: documentPath(), routePath: pathname, search });
  const reloadTo = placement.kind === "reload" ? placement.to : null;
  useEffect(() => {
    if (reloadTo !== null) window.location.replace(reloadTo);
  }, [reloadTo]);
  if (placement.kind === "run") return <OwnerAutomataPage />;
  return (
    <main className="page owner-automata-status">
      {placement.kind === "framed" ? <p role="alert">{WORDS.framed}</p> : <p>{WORDS.loading}</p>}
    </main>
  );
}
