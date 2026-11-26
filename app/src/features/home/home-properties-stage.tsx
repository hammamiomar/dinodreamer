// Scene 1 stage: side-by-side comparison of a basis group's strongest library pictures (each with
// its 16 × 16 patch outlined) and the live cellular automaton grown toward either that basis
// group's 3 coordinates alone or the full 768-number patch token, paired with a visual 3-vs-768
// token decomposition bar so the true labels explain themselves visually.

import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { useLibrary } from "../../app/library-session";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { ManifoldFocus } from "../../ground/manifold-focus";
import type { AtlasCloud } from "../../library/atlas-cloud";
import { PATCH_SLOT_OFFSET } from "../../recipe";
import { LibraryImage } from "../../ui/library-image";
import { ResetMark } from "../../ui/reset-mark";
import { Segmented } from "../../ui/segmented";
import { useLoaded } from "../../ui/use-loaded";
import { levelReadingOrder } from "../atlas/level-pictures";
import { groupPath } from "../automata/gallery";
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
/** Each patch token is reconstructed from 32 selected 3-coordinate basis groups (32 × 3 vs 768). */
const SELECTED_SLOTS = 32;

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

/**
 * Visual diagram of what `Basis group` (one 3-coordinate subspace) vs `Patch token` (all 768
 * numbers of the patch description) targets, making the true terms immediately perceptual.
 */
function TargetVectorMeter({ target, accent }: { target: PropertyTarget; accent: string | null }) {
  const fullToken = target === "token";
  const style = accent ? ({ "--sampled": accent } as CSSProperties) : undefined;
  return (
    <div className="home-vector-meter" style={style} aria-hidden="true">
      <div className="home-vector-slots">
        {Array.from({ length: SELECTED_SLOTS }, (_, slot) => (
          <span
            key={slot}
            className="home-vector-slot"
            data-lit={fullToken || slot === 0 || undefined}
          />
        ))}
      </div>
      <span className="home-vector-readout">
        {fullToken ? "Full patch token · 768 numbers" : "1 of 32 selected groups · 3 numbers"}
      </span>
    </div>
  );
}

export function HomePropertiesStage({ entries, approached, active, still, onNoReplay, onFocus }: {
  entries: readonly MaterialEntry[];
  approached: boolean;
  active: boolean;
  still: HomeStill;
  onNoReplay: () => void;
  onFocus?: (focus: ManifoldFocus) => void;
}) {
  const library = useLibrary();
  const [group, setGroup] = useState<PropertyGroup>(PROPERTY_GROUPS[0]);
  const [target, setTarget] = useState<PropertyTarget>("group");
  const [resetKey, setResetKey] = useState(0);
  const [accent, setAccent] = useState<string | null>(null);

  useEffect(() => {
    onFocus?.({ group, accent });
  }, [onFocus, group, accent]);

  const resolved = resolvePropertyView(entries, group, target);
  const material = usePublishedMaterial(!still && approached ? resolved.entry : null);
  const cloud = useLoaded(approached ? `properties:${group}` : null, () => (approached ? library.atlasCloud(group) : null));
  const pictures = cloud.status === "ready" ? levelReadingOrder(cloud.value.pictures, SHOWN_PICTURES).slice(0, SHOWN_PICTURES) : [];
  const placeholders = Math.max(0, SHOWN_PICTURES - pictures.length);

  const groupSegments = PROPERTY_GROUPS.map((candidate) => ({
    value: String(candidate),
    label: fill(WORDS.groupTab, { block: candidate }),
  }));
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
        onChange={(value) => {
          setGroup(Number(value) as PropertyGroup);
          setAccent(null);
        }}
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
                key={`${resolved.entry.id}-${resetKey}`}
                entry={resolved.entry}
                material={!still && material.status === "ready" ? material.value : null}
                playing={active && !still}
                stepsPerSecond={HOME_TICKS_PER_SECOND}
                regrowAtTick={REGROW_AT_TICK}
                brushRing
                demoStroke={active && !still}
                onAccent={setAccent}
                onNoReplay={onNoReplay}
              />
            )}
          </div>
        </div>
      </div>

      <div className="home-properties-controls">
        <div className="home-properties-bar">
          <Segmented
            label={WORDS.targetChoiceName}
            segments={targetSegments}
            value={target}
            onChange={(nextTarget) => {
              setTarget(nextTarget);
              setAccent(null);
            }}
          />
          <button
            type="button"
            className="link-control home-regrow-button"
            disabled={still !== null || !resolved.entry}
            onClick={() => setResetKey((count) => count + 1)}
          >
            <ResetMark />
            <span>{WORDS.regrow}</span>
          </button>
        </div>
        <TargetVectorMeter target={target} accent={accent} />
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
