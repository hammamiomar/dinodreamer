// The desktop right-hand stage of the home page (`home-page.tsx`): sticky across the viewport
// height, cross-fading cleanly from the full-bleed entrance automaton through the four interactive
// stages as the reader scrolls. Inactive layers are marked `inert` so keyboard focus and pointer
// events only reach the stage currently shown.

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ManifoldFocus } from "../../ground/manifold-focus";
import type { FigureMaterial } from "../../materials/material-file";
import type { MaterialEntry } from "../gallery/material-index";
import { AUTOMATON_RECORD_FOLDER, type AutomatonState } from "../how/automaton-record";
import { HOW_REGROW_AT_TICK } from "../how/figures/figure-data";
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
  end,
  endState,
  reset,
  entries,
  indexReady,
  approached,
  onNoReplay,
  onEntranceAccent,
  onPropertiesFocus,
  onCollectionFocus,
  onTrainFocus,
  onKeepFocus,
  onEndAccent,
}: {
  beat: HomeBeat;
  still: HomeStill;
  entrance: Shown | null;
  end: Shown | null;
  endState: AutomatonState | null;
  reset: number;
  entries: readonly MaterialEntry[];
  indexReady: boolean;
  approached: Record<HomeBeat, boolean>;
  onNoReplay: () => void;
  onEntranceAccent: (accent: string) => void;
  onPropertiesFocus: (focus: ManifoldFocus) => void;
  onCollectionFocus: (focus: ManifoldFocus) => void;
  onTrainFocus: (focus: ManifoldFocus) => void;
  onKeepFocus: (focus: ManifoldFocus) => void;
  onEndAccent: (accent: string) => void;
}) {
  const endInitialState = useMemo(() => (endState ? {
    tick: endState.replay.tick,
    fine: endState.fine.state,
    coarse: endState.coarse.state,
  } : undefined), [endState]);

  return (
    <div className="home-panel" data-framed={(beat !== "entrance" && beat !== "end") || undefined}>
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
            onAccent={onEntranceAccent}
            onNoReplay={onNoReplay}
          />
        )}
      </StageLayer>

      <StageLayer shown={beat === "properties"} className="home-layer-stage">
        <HomePropertiesStage
          entries={entries}
          approached={approached.properties}
          active={beat === "properties"}
          still={still}
          onNoReplay={onNoReplay}
          onFocus={onPropertiesFocus}
        />
      </StageLayer>

      <StageLayer shown={beat === "collection"} className="home-layer-stage">
        <HomeCollectionStage
          entries={entries}
          indexReady={indexReady}
          approached={approached.collection}
          active={beat === "collection"}
          onFocus={onCollectionFocus}
        />
      </StageLayer>

      <StageLayer shown={beat === "train"} className="home-layer-stage">
        <HomeTrainStage
          entries={entries}
          approached={approached.train}
          active={beat === "train"}
          still={still}
          onNoReplay={onNoReplay}
          onFocus={onTrainFocus}
        />
      </StageLayer>

      <StageLayer shown={beat === "keep"} className="home-layer-stage">
        <HomeKeepStage
          entries={entries}
          approached={approached.keep}
          active={beat === "keep"}
          still={still}
          onFocus={onKeepFocus}
        />
      </StageLayer>

      <StageLayer shown={beat === "end"} className="home-layer-live">
        {end && (
          <HomeMaterial
            entry={end.entry}
            material={!still && endInitialState ? end.material : null}
            initialState={endInitialState}
            playing={beat === "end"}
            posterUrl={`${AUTOMATON_RECORD_FOLDER}picture-128.png`}
            drawRatio={FIELD_DRAW_RATIO}
            regrowAtTick={HOW_REGROW_AT_TICK}
            stepsPerSecond={HOME_TICKS_PER_SECOND}
            brushRing
            onAccent={onEndAccent}
            onNoReplay={onNoReplay}
          />
        )}
      </StageLayer>
    </div>
  );
}
