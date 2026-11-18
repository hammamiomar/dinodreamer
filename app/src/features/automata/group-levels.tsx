// A basis group's own patches, by response level: the photographs of the library where the group
// responds, each with its patch marked, four per level. On a group's screen they stand beside the
// stage, the strongest level nearest it, so what DINO's images show and what the automaton grew are
// read together. The pictures and their counts are the Index's record of the group
// (features/atlas/card-loading.ts): the same read, the same marks, the same level colours.

import type { CSSProperties } from "react";
import { useLibrary } from "../../app/library-session";
import { SITE_WORDS } from "../../app/site-words";
import type { AtlasBand } from "../../library/atlas-cloud";
import { PATCH_SLOT_OFFSET } from "../../recipe";
import { LibraryImage } from "../../ui/library-image";
import { useLoaded } from "../../ui/use-loaded";
import { ATLAS_TEXT } from "../atlas/atlas-text";
import { pictureSlots, type PictureSlot } from "../atlas/card-loading";
import { cardLoader } from "../atlas/cloud-card";
import { BasisGroupLink } from "../look/basis-group-panel";
import { BAND_COLOURS } from "../look/strength-bands";
import { levelPassage } from "./wall-passage";

const WORDS = SITE_WORDS.automata;
/** The levels in reading order: the strongest first, so it stands nearest the stage. */
export const LEVELS_STRONGEST_FIRST: readonly AtlasBand[] = [3, 2, 1, 0];
/** A library picture is 16 × 16 patches; a slot names one of them after the class and register tokens. */
const PATCHES_PER_SIDE = 16;

/** One picture with its patch marked, or a quiet tile where the picture could not be read. */
export function LevelPicture({ slot, block, band }: { slot: PictureSlot; block: number; band: AtlasBand }) {
  const library = useLibrary();
  if (slot.kind === "tile") return <span className="automata-level-picture automata-level-tile" aria-hidden="true" />;
  const patch = slot.picture.slot - PATCH_SLOT_OFFSET;
  const left = ((patch % PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100;
  const top = (Math.floor(patch / PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100;
  return (
    <BasisGroupLink block={block} className="automata-level-picture">
      <LibraryImage src={library.thumbnailUrl(slot.picture.imageId)} alt={ATLAS_TEXT.pictureName(block, ATLAS_TEXT.bands[band])} loading="lazy" />
      <i style={{ left: `${left}%`, top: `${top}%` }} />
    </BasisGroupLink>
  );
}

export function GroupLevels({ block }: { block: number }) {
  const library = useLibrary();
  const content = useLoaded(block, () => cardLoader(library).load(block, "screen"));
  if (content.status === "failed") return <p className="automata-levels-status muted">{WORDS.levelsFailed}</p>;
  const cloud = content.status === "ready" ? content.value.cloud : null;
  const failed = content.status === "ready" ? content.value.failed : null;
  const slots = cloud && failed ? pictureSlots(cloud.pictures, (picture) => failed.has(library.thumbnailUrl(picture.imageId))) : null;
  return (
    <section className="automata-levels" aria-label={WORDS.levelsName} aria-busy={cloud === null}>
      {LEVELS_STRONGEST_FIRST.map((band) => (
        <div key={band} className="automata-level" role="group" aria-label={ATLAS_TEXT.bands[band]} style={{ "--band": BAND_COLOURS[band] } as CSSProperties}>
          <div className="automata-level-pictures" style={{ viewTransitionName: levelPassage(band) }}>
            {(slots?.[band] ?? []).map((slot, position) => (
              <LevelPicture key={position} slot={slot} block={block} band={band} />
            ))}
          </div>
          <p className="automata-level-name">
            <b>{ATLAS_TEXT.bands[band]}</b>
            <span>{cloud ? ATLAS_TEXT.count(cloud.counts[band], cloud.total) : ""}</span>
          </p>
        </div>
      ))}
    </section>
  );
}
