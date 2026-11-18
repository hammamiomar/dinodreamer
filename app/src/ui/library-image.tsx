// Library pictures share a CORS cache entry with worker downloads. An older cached response
// may lack Access-Control-Allow-Origin and remain immutable for a year. Retry failed images
// once per URL per page with cache: "reload" to replace that entry; all views await the same
// reload before trying again.
//
// React 18 applies attributes in prop order, so crossOrigin must precede src. CSS backgrounds
// cannot request CORS mode; useLibraryObjectUrl gives them a local URL instead.

import "./library-image.css";
import { forwardRef, useEffect, useState } from "react";
import type { ImgHTMLAttributes } from "react";

/** Each URL's one reload in this page, shared by every view that failed on it. */
const reloads = new Map<string, Promise<void>>();

/**
 * Replaces the cached copy of `url` with a CORS one, once per page: a later call, during the reload
 * or after it, waits for the same download. It resolves whether the download succeeds or not.
 */
export function reloadLibraryUrl(url: string, priority?: RequestPriority): Promise<void> {
  let reload = reloads.get(url);
  if (!reload) {
    reload = fetch(url, { cache: "reload", credentials: "omit", priority })
      .then((response) => response.arrayBuffer())
      .then(
        () => undefined,
        // The picture cannot be read; the view's next load reports it.
        () => undefined,
      );
    reloads.set(url, reload);
  }
  return reload;
}

export type LibraryImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "crossOrigin"> & { src: string };

/** Which picture a LibraryImage shows, and whether it is that picture's second element, loaded after a reload. */
export interface ImageAttempt {
  src: string;
  reloaded: boolean;
}

/** The attempt for `src`: the same one while src stays, a first attempt when it changes. */
export function attemptFor(attempt: ImageAttempt, src: string): ImageAttempt {
  return attempt.src === src ? attempt : { src, reloaded: false };
}

/**
 * The attempt once the reload of `reloadedSource` has finished: the second element for that picture,
 * unless src changed meanwhile. A late reload leaves the newer picture alone.
 */
export function attemptAfterReload(attempt: ImageAttempt, reloadedSource: string): ImageAttempt {
  return attempt.src === reloadedSource && !attempt.reloaded ? { src: reloadedSource, reloaded: true } : attempt;
}

/**
 * An <img> of a library picture: crossOrigin is its first attribute and src its last, so the
 * browser's only request carries an Origin. A failed load reloads the URL once and loads again in
 * a new element; the caller's onError runs only when that load fails too.
 */
export const LibraryImage = forwardRef<HTMLImageElement, LibraryImageProps>(function LibraryImage({ src, alt, onError, onLoad, ...attributes }, ref) {
  const [settledSource, setSettledSource] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<ImageAttempt>({ src, reloaded: false });
  // A new src starts a new attempt (React's pattern for state that follows a prop).
  const current = attemptFor(attempt, src);
  if (current !== attempt) setAttempt(current);
  return (
    <img
      key={current.reloaded ? "reloaded" : "first"}
      // First: React 18 sets the attributes in this order, and src, last, starts the load.
      crossOrigin="anonymous"
      ref={ref}
      {...attributes}
      alt={alt}
      data-library-loading={settledSource !== src || undefined}
      onLoad={(event) => { setSettledSource(src); onLoad?.(event); }}
      src={src}
      onError={(event) => {
        if (current.reloaded) {
          setSettledSource(src);
          onError?.(event);
          return;
        }
        void reloadLibraryUrl(src).then(() => setAttempt((latest) => attemptAfterReload(latest, src)));
      }}
    />
  );
});

/** Loads and decodes a library picture in CORS mode; after a failure, reloads the URL once and tries again. */
export async function loadLibraryPicture(url: string, { priority, signal }: { priority?: RequestPriority; signal?: AbortSignal } = {}): Promise<HTMLImageElement> {
  try {
    return await decodedPicture(url, priority, signal);
  } catch {
    signal?.throwIfAborted();
    await reloadLibraryUrl(url, priority);
    return decodedPicture(url, priority, signal);
  }
}

function decodedPicture(url: string, priority?: RequestPriority, signal?: AbortSignal): Promise<HTMLImageElement> {
  signal?.throwIfAborted();
  const picture = new Image();
  // Before src, which starts the request.
  picture.crossOrigin = "anonymous";
  if (priority) (picture as HTMLImageElement & { fetchPriority?: string }).fetchPriority = priority;
  const release = () => picture.removeAttribute("src");
  signal?.addEventListener("abort", release, { once: true });
  picture.src = url;
  return picture.decode().then(() => picture).finally(() => signal?.removeEventListener("abort", release));
}

/**
 * A local object URL of a library picture, for a stylesheet that slices it (a CSS background is
 * a plain load); null until the picture is read, and if it cannot be. Revoked when the URL changes
 * or the view goes.
 */
export function useLibraryObjectUrl(url: string): string | null {
  const [objectUrl, setObjectUrl] = useState<{ url: string; local: string } | null>(null);
  useEffect(() => {
    let local: string | null = null;
    let cancelled = false;
    const read = () => fetch(url, { credentials: "omit" }).then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))));
    read()
      .catch((error: unknown) => (error instanceof TypeError ? reloadLibraryUrl(url).then(read) : Promise.reject(error)))
      .then((blob) => {
        if (cancelled) return;
        local = URL.createObjectURL(blob);
        setObjectUrl({ url, local });
      })
      .catch(() => {
        // The view shows its cells empty, as before a picture arrives.
      });
    return () => {
      cancelled = true;
      if (local) URL.revokeObjectURL(local);
    };
  }, [url]);
  return objectUrl?.url === url ? objectUrl.local : null;
}
