import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { LibraryReadError } from "../library/library";
import { SITE_WORDS } from "./site-words";
import "./route-error.css";

/**
 * A screen failed to load; the frame and the creation in progress stay. An address that is not a
 * page (or a block page's number that is not a block) is one line with the way to the Index, on the
 * module, and never repeats the address; any other failure keeps its heading and its error.
 */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <main className="page not-found">
        <h1>
          {typeof error.data === "string" && error.data.length > 0 ? error.data : SITE_WORDS.frame.notFoundDetail}{" "}
          <Link to="/index">{SITE_WORDS.frame.backToExplore}</Link>
        </h1>
      </main>
    );
  }
  return (
    <main className="page page-message">
      <h1>{errorTitle(error)}</h1>
      <p className="muted">{errorDetail(error)}</p>
      <Link className="button" to="/index">
        {SITE_WORDS.frame.backToExplore}
      </Link>
    </main>
  );
}

export function errorTitle(error: unknown): string {
  if (error instanceof LibraryReadError && error.missing) return SITE_WORDS.frame.notInRelease;
  if (isRouteErrorResponse(error) && error.status === 404) return SITE_WORDS.frame.notFound;
  return SITE_WORDS.frame.pageFailed;
}

export function errorDetail(error: unknown): string {
  if (isRouteErrorResponse(error)) return String(error.data);
  return error instanceof Error ? error.message : String(error);
}
