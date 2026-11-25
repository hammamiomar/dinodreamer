// The desktop right-hand stage of the home page (`home-page.tsx`): sticky across the viewport
// height, cross-fading cleanly from the full-bleed entrance automaton through the four interactive
// stages as the reader scrolls. Inactive layers are marked `inert` so keyboard focus and pointer
// events only reach the stage currently shown.

import { useEffect, useRef, type ReactNode } from "react";
import type { FigureMaterial } from "../../materials/material-file";
import type { BasisGroupNames } from "../gallery/basis-groups";
import type { MaterialEntry } from "../gallery/material-index";
import { HomeCollectionStage } from "./home-collection-stage";
import { HomeKeepStage } from "./home-keep-stage";
import { HOME_TICKS_PER_SECOND } from "./home-material";
import { HomeMaterial, type HomeStill } from "./home-material-view";
import { HomePropertiesStage } from "./home-properties-stage";
import type { HomeBeat } from "./home-scroll";
import { HomeTrainStage } from "./home-train-stage";

/** Full-window field renders at 1 device pixel per CSS pixel so cells remain crisp and GPU cost stays low. */
export const FIELD_DRAW_RATIO = 1;

/** An automaton to run: its index entry and its loaded file (null until loaded). */
export interface Shown {
  entry: MaterialEntry;
  material: FigureMaterial | null;
}

function StageLayer({ shown, className, children }: {
  shown: boolean;
  className: string;
  children: ReactNode;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (layer.current) layer.current.inert = !shown;
  }, [shown]);
  return (
    <div ref={layer} className={`home-layer ${className}`} data-shown={shown || undefined}>
      {children}
    </div>
  );
}

export function HomePanel({
  beat,
  still,
  entrance,
  reset,
  entries,
  indexReady,
  names,
  approached,
  onNoReplay,
}: {
  beat: HomeBeat;
  still: HomeStill;
  entrance: Shown | null;
  reset: number;
  entries: readonly MaterialEntry[];
  indexReady: boolean;
  names: BasisGroupNames;
  approached: Record<HomeBeat, boolean>;
  onNoReplay: () => void;
}) {
  return (
    <div className="home-panel" data-framed={beat !== "entrance" || undefined}>
      <StageLayer shown={beat === "entrance"} className="home-layer-live">
        {entrance && (
          <HomeMaterial
            key={reset}
            entry={entrance.entry}
            material={beat === "entrance" && !still ? entrance.material : null}
            posterWhileRunning={false}
            drawRatio={FIELD_DRAW_RATIO}
            regrowAtTick={Number.POSITIVE_INFINITY}
            stepsPerSecond={HOME_TICKS_PER_SECOND}
            brushRing
            carryCells
            onNoReplay={onNoReplay}
          />
        )}
      </StageLayer>

      <StageLayer shown={beat === "properties"} className="home-layer-stage">
        <HomePropertiesStage
          entries={entries}
          names={names}
          approached={approached.properties}
          active={beat === "properties"}
          still={still}
          onNoReplay={onNoReplay}
        />
      </StageLayer>

      <StageLayer shown={beat === "collection"} className="home-layer-stage">
        <HomeCollectionStage
          entries={entries}
          indexReady={indexReady}
          names={names}
          approached={approached.collection}
        />
      </StageLayer>

      <StageLayer shown={beat === "train"} className="home-layer-stage">
        <HomeTrainStage
          entries={entries}
          names={names}
          approached={approached.train}
          active={beat === "train"}
          still={still}
          onNoReplay={onNoReplay}
        />
      </StageLayer>

      <StageLayer shown={beat === "keep"} className="home-layer-stage">
        <HomeKeepStage
          entries={entries}
          names={names}
          approached={approached.keep}
          active={beat === "keep"}
          still={still}
        />
      </StageLayer>
    </div>
  );
}
