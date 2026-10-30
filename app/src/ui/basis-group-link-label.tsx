import "./basis-group-link-label.css";

/** A visible opening cue for a basis-group number inside an existing link or button. */
export function BasisGroupLinkLabel({ block }: { block: number }) {
  return (
    <span className="basis-group-link-label">
      <span className="basis-group-link-number">{block}</span>
      <span className="basis-group-link-chevron" aria-hidden="true">›</span>
    </span>
  );
}
