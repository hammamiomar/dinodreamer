// Scene 1 stage: side-by-side comparison of a basis group's strongest library photographs (each with
// its 16 × 16 patch outlined) and the live cellular automaton grown toward either that group's three
// coordinates alone or DINOv3's full 768-number token.

import { useState } from "react";
import { Link } from "react-router";
import { useLibrary } from "../../app/library-session";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { AtlasCloud } from "../../library/atlas-cloud";
import { PATCH_SLOT_OFFSET } from "../../recipe";
import { LibraryImage } from "../../ui/library-image";
import { Segmented } from "../../ui/segmented";
import { useLoaded } from "../../ui/use-loaded";
import { levelReadingOrder } from "../atlas/level-pictures";
import { groupPath } from "../automata/gallery";
import { nameOf, type BasisGroupNames } from "../gallery/basis-groups";
import { usePublishedMaterial } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { HOME_TICKS_PER_SECOND, REGROW_AT_TICK } from "./home-material";
import { HomeMaterial, type HomeStill } from "./home-material-view";
import {
  PROPERTY_GROUPS,
  resolvePropertyView,
  type PropertyGroup,
  type PropertyTarget,
} from "./home-specimens";

const WORDS = SITE_WORDS.home.properties;
const PATCHES_PER_SIDE = 16;
const SHOWN_PICTURES = 4;

/** One library picture with its active 16 × 16 patch outlined. */
export function MarkedPatchPicture({ picture, block }: {
  picture: AtlasCloud["pictures"][number];
  block: number;
}) {
  const library = useLibrary();
  const patch = picture.slot - PATCH_SLOT_OFFSET;
  const left = ((patch % PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100;
  const top = (Math.floor(patch / PATCHES_PER_SIDE) / PATCHES_PER_SIDE) * 100;
  return (
    <span className="home-patch-picture">
      <LibraryImage
        src={library.thumbnailUrl(picture.imageId)}
        alt={fill(WORDS.pictureAlt, { block })}
        decoding="async"
      />
      <i style={{ left: `${left}%`, top: `${top}%` }} aria-hidden="true" />
    </span>
  );
}

export function HomePropertiesStage({ entries, names, approached, active, still, onNoReplay }: {
  entries: readonly MaterialEntry[];
  names: BasisGroupNames;
  approached: boolean;
  active: boolean;
  still: HomeStill;
  onNoReplay: () => void;
}) {
  const library = useLibrary();
  const [group, setGroup] = useState<PropertyGroup>(PROPERTY_GROUPS[0]);
  const [target, setTarget] = useState<PropertyTarget>("group");

  const resolved = resolvePropertyView(entries, group, target);
  const material = usePublishedMaterial(!still && approached ? resolved.entry : null);
  const cloud = useLoaded(approached ? `properties:${group}` : null, () => (approached ? library.atlasCloud(group) : null));
  const pictures = cloud.status === "ready" ? levelReadingOrder(cloud.value.pictures, SHOWN_PICTURES).slice(0, SHOWN_PICTURES) : [];
  const placeholders = Math.max(0, SHOWN_PICTURES - pictures.length);

  const groupSegments = PROPERTY_GROUPS.map((candidate) => {
    const labelName = nameOf(names, candidate) ?? WORDS.groupDefaultNames[candidate];
    return {
      value: String(candidate),
      label: `${candidate} · ${labelName}`,
    };
  });
  const targetSegments = [
    { value: "group" as const, label: WORDS.targets.group },
    { value: "token" as const, label: WORDS.targets.token },
  ];

  const caption = resolved.exact
    ? WORDS.notes[group][target]
    : fill(WORDS.fallbackCaption, { block: resolved.entry?.block ?? group });

  return (
    <div className="home-stage-frame home-properties">
      <Segmented
        label={WORDS.groupChoiceName}
        segments={groupSegments}
        value={String(group)}
        onChange={(value) => setGroup(Number(value) as PropertyGroup)}
      />

      <div className="home-properties-pair">
        <div className="home-properties-column">
          <span className="label">{WORDS.picturesHeading}</span>
          {cloud.status === "failed" ? (
            <div className="home-square-placeholder">
              <p className="muted">{WORDS.picturesFailed}</p>
            </div>
          ) : (
            <div className="home-patch-grid" aria-busy={approached && cloud.status !== "ready"}>
              {pictures.map((picture) => (
                <MarkedPatchPicture key={`${picture.imageId}-${picture.slot}`} picture={picture} block={group} />
              ))}
              {Array.from({ length: placeholders }, (_, index) => (
                <span key={`empty-${index}`} className="home-patch-picture" aria-hidden="true" />
              ))}
            </div>
          )}
        </div>

        <div className="home-properties-column">
          <span className="label">{still ? WORDS.automatonStillHeading : WORDS.automatonHeading}</span>
          <div className="home-properties-automaton">
            {resolved.entry && (
              <HomeMaterial
                key={resolved.entry.id}
                entry={resolved.entry}
                material={!still && material.status === "ready" ? material.value : null}
                playing={active && !still}
                stepsPerSecond={HOME_TICKS_PER_SECOND}
                regrowAtTick={REGROW_AT_TICK}
                brushRing
                onNoReplay={onNoReplay}
              />
            )}
          </div>
        </div>
      </div>

      <div className="home-properties-controls">
        <Segmented
          label={WORDS.targetChoiceName}
          segments={targetSegments}
          value={target}
          onChange={setTarget}
        />
        <p className="home-stage-caption">
          <span>{caption}</span>
          <Link className="link-control" to={groupPath(resolved.entry?.block ?? group, resolved.entry?.id ?? null)}>
            {fill(WORDS.openGroup, { block: resolved.entry?.block ?? group })}
          </Link>
        </p>
      </div>
    </div>
  );
}
