// The stage's figure for a section (how-page.tsx): one component per act, kept mounted across the
// act's sections so a picture is not reloaded and a player keeps running; the section's figure
// name chooses the mode.
import type { HowFigure as HowFigureName } from "../how-sections";
import { AutomatonFigure } from "./automaton-figure";
import { BasisFigure } from "./basis-figure";
import { DinoFigure } from "./dino-figure";
import { LoopFigure } from "./loop-figure";
import { ReferencesFigure } from "./references-figure";
import { VisualizationFigure } from "./visualization-figure";

export function HowFigure({ figure }: { figure: HowFigureName }) {
  if (figure === "patches" || figure === "attention") return <DinoFigure mode={figure} />;
  if (figure === "basis-place" || figure === "selection" || figure === "cloud" || figure === "rebuild" || figure === "basis-training") return <BasisFigure mode={figure} />;
  if (figure === "cells" || figure === "scales" || figure === "signal" || figure === "updates" || figure === "local-global" || figure === "kinds") return <AutomatonFigure mode={figure} />;
  if (figure === "visualization") return <VisualizationFigure />;
  if (figure === "loop") return <LoopFigure />;
  return <ReferencesFigure />;
}
