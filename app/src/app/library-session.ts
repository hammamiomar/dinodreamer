// The one library client of the session. The root route loads the release
// manifest before any screen renders, so every component below it can read the
// library synchronously, and route loaders can await the same client.

import { useRouteLoaderData } from "react-router";
import { openLibrary } from "../library/library";
import type { Library } from "../library/library";
import { ASSET_BASE_URL, RELEASE_NAME } from "./config";

export const ROOT_ROUTE_ID = "root";

let opening: Promise<Library> | null = null;

/** Opens the release once; a failed open is forgotten so the next navigation retries. */
export function appLibrary(): Promise<Library> {
  if (!opening) {
    const attempt = openLibrary({ baseUrl: ASSET_BASE_URL, release: RELEASE_NAME });
    attempt.catch(() => {
      if (opening === attempt) opening = null;
    });
    opening = attempt;
  }
  return opening;
}

export async function rootLoader(): Promise<{ library: Library }> {
  return { library: await appLibrary() };
}

export function useLibrary(): Library {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as Awaited<ReturnType<typeof rootLoader>> | undefined;
  if (!data) throw new Error("useLibrary needs the root route's library");
  return data.library;
}
