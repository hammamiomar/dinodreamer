// The bridge to the automata: what feature visualization painted when asked to reach the followed
// patch's point, beside the patch itself. The two painted pictures were made with the
// Painter (app/public/how/visualization/): both grown from noise toward the patch's point in its
// basis group, the second with the hibiscus as its appearance reference. Each pane plays the
// recorded growth once, then shows the Painter's export, which is sharper than the recording.
import { useEffect, useRef, useState } from "react";
import { useLibrary } from "../../../app/library-session";
import { fill, SITE_WORDS } from "../../../app/site-words";
import { usePrefersReducedMotion } from "../../../ui/tween";
import { PictureWithPatches } from "../how-figures";
import { tokenName } from "../how-names";
import { PREFIX } from "../how-shapes";
import { HOW_PICTURE } from "../how-source";
import { FigureCaption } from "./figure-caption";
import "./figures.css";

const WORDS = SITE_WORDS.how.figures;
const CAPTIONS = [
  fill(WORDS.visualizationPatch, { patch: tokenName(PREFIX + HOW_PICTURE.patch) }),
  WORDS.visualizationNoise,
  WORDS.visualizationReference,
];

/** The Painter's recordings and exports, at the Painter's canvas size. */
const PAINTED = {
  fromNoise: { growth: "/how/visualization/from-noise.mp4", still: "/how/visualization/from-noise.png" },
  withReference: { growth: "/how/visualization/with-hibiscus.mp4", still: "/how/visualization/with-hibiscus.png" },
} as const;
export function VisualizationFigure() {
  const library = useLibrary();
  const patch = tokenName(PREFIX + HOW_PICTURE.patch);
  return (
    <div className="how-visualization">
      <div className="how-pair" data-columns={3}>
        <figure className="how-pane">
          <div className="how-visual">
            <PictureWithPatches src={library.previewUrl(HOW_PICTURE.imageId)} pinned={HOW_PICTURE.patch} alt={fill(WORDS.pictureAlt, { image: HOW_PICTURE.imageId })} />
          </div>
          <FigureCaption reserve={CAPTIONS}>{fill(WORDS.visualizationPatch, { patch })}</FigureCaption>
        </figure>
        <PaintedPane picture={PAINTED.fromNoise} caption={WORDS.visualizationNoise} />
        <PaintedPane picture={PAINTED.withReference} caption={WORDS.visualizationReference} />
      </div>
    </div>
  );
}

/**
 * A painted picture: its growth from noise plays once when the pane appears, then the export fades
 * in over the recording's last frame; a click plays the growth again. With reduced motion the
 * export is shown and the growth waits for the click.
 */
function PaintedPane({ picture, caption }: { picture: { growth: string; still: string }; caption: string }) {
  const reduce = usePrefersReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [growing, setGrowing] = useState(!reduce);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let current = true;
    if (reduce) {
      element.pause();
      setGrowing(false);
    } else {
      setGrowing(true);
      void element.play().catch(() => { if (current) setGrowing(false); });
    }
    return () => {
      current = false;
      element.pause();
    };
  }, [reduce]);
  const replay = () => {
    const element = video.current;
    if (!element) return;
    setGrowing(true);
    element.currentTime = 0;
    void element.play().catch(() => setGrowing(false));
  };
  return (
    <figure className="how-pane">
      <div className="how-visual">
        <button type="button" className="how-painted" onClick={replay} aria-label={WORDS.visualizationReplay} data-growing={growing ? "" : undefined}>
          <video ref={video} src={picture.growth} width={256} height={256} muted playsInline preload={reduce ? "metadata" : "auto"} onEnded={() => setGrowing(false)} onError={() => setGrowing(false)} aria-hidden="true" />
          <img src={picture.still} width={256} height={256} alt="" />
        </button>
      </div>
      <FigureCaption reserve={CAPTIONS}>{caption}</FigureCaption>
    </figure>
  );
}
