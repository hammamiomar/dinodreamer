// The overview's figure: the loop in its real objects. The hibiscus with the followed patch, that
// patch's point in group 4009's cloud, and the automaton trained toward that point, growing. The
// map above runs the same loop as a drawing.
import { useState } from "react";
import { useLibrary } from "../../../app/library-session";
import { fill, SITE_WORDS } from "../../../app/site-words";
import { AtlasCloudFigure } from "../../../ui/atlas-cloud-figure";
import { useMediaMatch } from "../../../ui/media-match";
import { useLoaded } from "../../../ui/use-loaded";
import { useMaterialIndex, usePublishedMaterial } from "../../gallery/material-gallery";
import { materialsOfBlock } from "../../gallery/material-index";
import { HomeMaterial, type HomeStill } from "../../home/home-material-view";
import { usePrefersReducedMotion } from "../../landing/motion";
import { BAND_NAMES, STRENGTH_BANDS } from "../../look/strength-bands";
import { PictureWithPatches } from "../how-figures";
import { tokenName } from "../how-names";
import { PREFIX } from "../how-shapes";
import { HOW_PICTURE } from "../how-source";
import { HOW_AUTOMATON, HOW_REGROW_AT_TICK, loadHowStory } from "./figure-data";
import { FigureCaption } from "./figure-caption";
import "./figures.css";

const WORDS = SITE_WORDS.how.figures;
const CAPTIONS = [
  fill(WORDS.loopPatch, { patch: tokenName(PREFIX + HOW_PICTURE.patch) }),
  fill(WORDS.loopCloud, { group: HOW_PICTURE.block }),
  WORDS.loopAutomaton,
];

export function LoopFigure() {
  // One finger scrolls the mobile explanation, including when it starts on the live picture.
  const mobile = useMediaMatch("(max-width: 1023px)");
  const library = useLibrary();
  const index = useMaterialIndex();
  const cloud = useLoaded("cloud", () => library.atlasCloud(HOW_PICTURE.block));
  const story = useLoaded("story", loadHowStory);
  const reduced = usePrefersReducedMotion();
  const [noReplay, setNoReplay] = useState(false);
  const still: HomeStill = !("gpu" in navigator) || noReplay ? "no-webgpu" : reduced ? "reduced-motion" : null;
  const entry = index.status === "ready" ? materialsOfBlock(index.index, HOW_PICTURE.block).find((candidate) => candidate.id === HOW_AUTOMATON) ?? null : null;
  const material = usePublishedMaterial(still ? null : entry ?? null);
  const point = story.status === "ready" ? story.value.anchor : null;
  return (
    <div className="how-loop how-pair" data-columns={3}>
      <figure className="how-pane">
        <div className="how-visual">
          <PictureWithPatches src={library.previewUrl(HOW_PICTURE.imageId)} pinned={HOW_PICTURE.patch} alt={fill(WORDS.pictureAlt, { image: HOW_PICTURE.imageId })} />
        </div>
        <FigureCaption reserve={CAPTIONS}>{CAPTIONS[0]}</FigureCaption>
      </figure>
      <figure className="how-pane">
        <div className="how-visual">
          <div className="how-cloud-figure how-loop-cloud">
            {cloud.status === "ready" && point && (
              <AtlasCloudFigure cloud={cloud.value} lit={point.atlasPoint} label={BAND_NAMES[STRENGTH_BANDS.indexOf(point.band)]} />
            )}
          </div>
        </div>
        <FigureCaption reserve={CAPTIONS}>{CAPTIONS[1]}</FigureCaption>
      </figure>
      <figure className="how-pane how-player">
        <div className="how-visual">
          {entry ? <HomeMaterial entry={entry} material={material.status === "ready" ? material.value : null} brush={!mobile} onNoReplay={() => setNoReplay(true)} regrowAtTick={HOW_REGROW_AT_TICK} /> : <div className="how-colors" />}
        </div>
        <FigureCaption reserve={CAPTIONS}>{CAPTIONS[2]}</FigureCaption>
      </figure>
    </div>
  );
}
