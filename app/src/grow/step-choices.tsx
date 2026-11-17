// The reading step's choice (decision 12 of the four-methods brief): after a run that compares with a set,
// a strip under the cells of the automaton's picture at each step of its ladder, the kept step marked. The
// run keeps the step of the lowest own loss; a click keeps the automaton at another (train-run.ts
// keepAtStep). Once the automaton is sent to the gallery its step is fixed.

import { SITE_WORDS, fill } from "../app/site-words";
import { useMaterialIndex } from "../features/gallery/material-gallery";
import { publishState, readSubmittedMaterials } from "../features/gallery/publish-material";
import type { FigureMaterialFile } from "../materials/material-file";
import { stepChoiceOpen } from "./grow-view";
import type { TrainLadder } from "./protocol";

const WORDS = SITE_WORDS.grow.step;

/** The step of the ladder's lowest own loss: the one a run keeps by itself. */
export function lowestLossStep(ladder: TrainLadder): number {
  return ladder.steps.reduce((lowest, step) => (step.loss < lowest.loss ? step : lowest)).tick;
}

/** The sentence under the pictures: where the automaton is read, and why, or what else its ladder says. */
export function stepSentence(ladder: TrainLadder, open: boolean): string {
  const step = ladder.kept.toLocaleString("en-US");
  if (!open) return fill(WORDS.closed, { step });
  const lowest = lowestLossStep(ladder);
  return lowest === ladder.kept ? fill(WORDS.lowest, { step }) : fill(WORDS.chosen, { step, lowest: lowest.toLocaleString("en-US") });
}

export function StepChoices({ ladder, open, onKeep }: {
  ladder: TrainLadder;
  /** Whether another step may be chosen: not once the automaton is sent to the gallery. */
  open: boolean;
  onKeep: (step: number) => void;
}) {
  return <div className="grow-steps">
    <div className="grow-step-strip" role="group" aria-label={WORDS.label}>
      {ladder.steps.map((step) => (
        <button key={step.tick} type="button" className="grow-step" aria-pressed={step.tick === ladder.kept} disabled={!open && step.tick !== ladder.kept}
          aria-label={fill(WORDS.picture, { step: step.tick.toLocaleString("en-US"), loss: step.loss.toPrecision(4) })}
          onClick={() => { if (open) onKeep(step.tick); }}>
          <img src={step.picture} alt="" />
          <span>{step.tick.toLocaleString("en-US")}</span>
        </button>
      ))}
    </div>
    <p className="grow-step-sentence">{stepSentence(ladder, open)}</p>
  </div>;
}

/**
 * The choice for a held run's kept file: open until that file is sent to the gallery (grow-view.ts
 * stepChoiceOpen), which the published index and this browser's record of what it sent tell.
 */
export function KeptStepChoices({ ladder, file, onKeep }: { ladder: TrainLadder; file: FigureMaterialFile | undefined; onKeep: (step: number) => void }) {
  const published = useMaterialIndex();
  const publishedIds = new Set(published.index.entries.map((entry) => entry.materialId));
  const open = file === undefined || stepChoiceOpen(publishState(file, publishedIds, readSubmittedMaterials()));
  return <StepChoices ladder={ladder} open={open} onKeep={onKeep} />;
}
