import { useEffect, useMemo, useRef, useState } from "react";
import type { FigureMaterial } from "../../materials/material-file";
import { useLoaded } from "../../ui/use-loaded";
import { materialCaption } from "./material-caption";
import { fetchPublishedMaterial } from "./material-gallery";
import type { MaterialEntry } from "./material-index";
import "./material-label.css";

const published = (entry: MaterialEntry) => fetchPublishedMaterial(entry.id);

/** Load recipe metadata near view. Saved and pending definitions use the stage's in-memory source. */
export function MaterialLabel({ entry, load = published }: {
  entry: MaterialEntry;
  load?: (entry: MaterialEntry) => Promise<FigureMaterial>;
}) {
  const label = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !label.current) return;
    const observer = new IntersectionObserver(([seen]) => {
      if (seen?.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "128px" });
    observer.observe(label.current);
    return () => observer.disconnect();
  }, [visible]);
  const key = useMemo(() => visible ? { id: entry.id, load } : null, [visible, entry.id, load]);
  const loaded = useLoaded(key, () => key ? load(entry) : null);
  const caption = materialCaption(entry, loaded.status === "ready" ? loaded.value.file : null, loaded.status === "failed");
  return <span ref={label} className="material-label">
    <span className="material-title">{caption.title}</span>
    {caption.recipe && <span className="material-recipe">{caption.recipe}</span>}
  </span>;
}
