// Browser file helpers shared by the Saved and Gallery pages.

import { useEffect, useState } from "react";

/** Starts a download of `blob` named `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // The download has started once click() returns; the URL is no longer needed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** An object URL for `blob` that lives as long as the component shows it. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}

/** "Collar and ball!" → "collar-and-ball"; never empty. */
export function fileStem(title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return stem || "canvas";
}
