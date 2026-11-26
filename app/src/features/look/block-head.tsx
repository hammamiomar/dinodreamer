// The block's number, cloud thumbnail, category, counts and primary Train action.
// A block without provenance shows its counts without a category.

import { Link } from "react-router";
import { useLibrary } from "../../app/library-session";
import { toggleStar, useStarredBlocks } from "../../storage/starred-blocks";
import { useLoaded } from "../../ui/use-loaded";
import { ATLAS_TEXT } from "../atlas/atlas-text";
import { CloudGlyph } from "../atlas/cloud-card";
import { LOOK_TEXT } from "./look-text";

export function BlockHead({ block, patches, materials, growHref, primaryGrow = true, onGrow, onGrowHover }: {
  block: number;
  /** The block's patches in the library: the full cloud's row count. */
  patches: number;
  /** Its published materials, or null while the index is read. */
  materials: number | null;
  growHref: string;
  /** False when PictureHere leads the panel with its own primary Train button. */
  primaryGrow?: boolean;
  /** Grow a material: the page hands Grow its default occurrence before the link opens it. */
  onGrow: () => void;
  /** The pointer or focus is on Grow a material: the page outlines the picture it grows toward. */
  onGrowHover: (hovered: boolean) => void;
}) {
  const library = useLibrary();
  const starred = useStarredBlocks().includes(block);
  const atlas = useLoaded(block, () => library.atlasCloud(block));
  const provenance = useLoaded(block, () => library.provenance(block));
  const family = provenance.status === "ready" ? provenance.value.roles.patch?.family : undefined;
  const familyName = family && Object.hasOwn(ATLAS_TEXT.families, family) && family !== "unknown"
    ? ATLAS_TEXT.families[family as keyof typeof ATLAS_TEXT.families]
    : null;
  return (
    <header className="look-head">
      <h1 className="display">{block}</h1>
      {/* The thumbnail fills this box: 256 × 96 beside the 104 px number, up to 128 × 64 on a phone (look.css). */}
      <div className="look-glyph" aria-hidden="true">
        {atlas.status === "ready" && <CloudGlyph cloud={atlas.value} fill />}
      </div>
      <div className="look-head-actions">
        <button
          type="button"
          className="button look-star"
          aria-label={LOOK_TEXT.head.starLabel(block)}
          aria-pressed={starred}
          onClick={() => toggleStar(block)}
        >
          <span aria-hidden="true">{starred ? "★" : "☆"}</span>
          {starred ? LOOK_TEXT.head.starred : LOOK_TEXT.head.star}
        </button>
        <Link
          className={primaryGrow ? "button primary look-grow" : "button look-grow"}
          to={growHref}
          onClick={(event) => {
            event.preventDefault();
            onGrow();
          }}
          onPointerEnter={() => onGrowHover(true)}
          onPointerLeave={() => onGrowHover(false)}
          onFocus={() => onGrowHover(true)}
          onBlur={() => onGrowHover(false)}
        >
          {LOOK_TEXT.head.grow}
        </Link>
      </div>
      <p className="look-line">
        {familyName && <span>{LOOK_TEXT.head.family(familyName)}</span>}
        <span>{LOOK_TEXT.head.patches(patches)}</span>
        {materials !== null && <span>{LOOK_TEXT.head.materials(materials)}</span>}
      </p>
    </header>
  );
}
