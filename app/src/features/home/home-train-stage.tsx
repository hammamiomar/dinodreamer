// Scene 3 stage: interactive recorded training scrubber for three noise-trained runs, pairing the
// reference patch against the cellular automaton across optimizer updates, with a visual 90%
// selection-target sparkline and the tangible published gallery plaque (`MakerCard`).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "react-router";
import { fill, SITE_WORDS } from "../../app/site-words";
import type { ManifoldFocus } from "../../ground/manifold-focus";
import { FIRES } from "../../materials/material-file";
import { MakerCard } from "../../replay/maker-card";
import { ResetMark } from "../../ui/reset-mark";
import { Segmented } from "../../ui/segmented";
import { useLoaded } from "../../ui/use-loaded";
import { groupPath } from "../automata/gallery";
import { usePublishedMaterial } from "../gallery/material-gallery";
import type { MaterialEntry } from "../gallery/material-index";
import { AUTOMATON_RECORD_FOLDER, loadAutomatonState } from "../how/automaton-record";
import { readStory, STORY_FILE, STORY_FOLDER, type Story, type TrainingFrame } from "../how/training-story";
import { HOME_TICKS_PER_SECOND, kindWords, REGROW_AT_TICK } from "./home-material";
import { HomeMaterial, type HomeStill } from "./home-material-view";
import { MarkedPatchPicture } from "./home-properties-stage";
import { selectTrainStories, storyEntryForRecord } from "./home-specimens";

const WORDS = SITE_WORDS.home.train;
const REPLAY_STEP_MS = 260;

let cachedStory: Promise<Story> | null = null;

function loadHomeStory(): Promise<Story> {
  return (cachedStory ??= fetch(STORY_FILE)
    .then((response) => {
      if (!response.ok) throw new Error(`${STORY_FILE} answered ${response.status}`);
      return response.json();
    })
    .then((value) => readStory(value))
    .catch((error: unknown) => {
      cachedStory = null;
      throw error;
    }));
}

/**
 * Direct interactive curve scrubber of selection fraction across optimizer updates, showing the
 * 90% selection target line so visitors can click, scrub, or use arrow keys along the training run.
 */
function SelectionSparkline({
  frames,
  stepIndex,
  accent,
  onSelectStep,
}: {
  frames: readonly TrainingFrame[];
  stepIndex: number;
  accent: string | null;
  onSelectStep: (index: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lastSelected = useRef(stepIndex);
  lastSelected.current = stepIndex;
  const [dragging, setDragging] = useState(false);

  if (frames.length < 2) return null;

  const width = 560;
  const height = 56;
  const padTop = 10;
  const padBottom = 10;
  const padLeft = 12;
  const padRight = 16;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const lastIndex = frames.length - 1;
  const toX = (index: number) => padLeft + (index / lastIndex) * plotW;
  const toY = (fraction: number) => padTop + (1 - Math.min(1, Math.max(0, fraction))) * plotH;
  const targetY = toY(FIRES);
  const path = frames
    .map((frame, index) => `${index === 0 ? "M" : "L"}${toX(index).toFixed(1)} ${toY(frame.winnerFraction).toFixed(1)}`)
    .join(" ");
  const active = frames[stepIndex]!;
  const activeX = toX(stepIndex);
  const activeY = toY(active.winnerFraction);
  const activeMet = active.winnerFraction >= FIRES;
  const style = accent ? ({ "--sampled": accent } as CSSProperties) : undefined;
  const valueText = fill(WORDS.readout, {
    update: active.update.toLocaleString("en-US"),
    wins: Math.round(active.winnerFraction * 100),
  });

  const indexForClientX = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return stepIndex;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return stepIndex;
    const u = ((clientX - rect.left) / rect.width) * width;
    const fraction = Math.max(0, Math.min(1, (u - padLeft) / plotW));
    return Math.round(fraction * lastIndex);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    setDragging(true);
    const nearest = indexForClientX(event.clientX);
    lastSelected.current = nearest;
    onSelectStep(nearest);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const nearest = indexForClientX(event.clientX);
    if (nearest !== lastSelected.current) {
      lastSelected.current = nearest;
      onSelectStep(nearest);
    }
  };

  const stopDragging = () => {
    setDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onSelectStep(Math.max(0, stepIndex - 1));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onSelectStep(Math.min(lastIndex, stepIndex + 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      onSelectStep(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onSelectStep(lastIndex);
    }
  };

  return (
    <div
      className="home-train-sparkline"
      style={style}
      role="slider"
      tabIndex={0}
      aria-label={WORDS.updateLabel}
      aria-valuemin={0}
      aria-valuemax={lastIndex}
      aria-valuenow={stepIndex}
      aria-valuetext={valueText}
      data-dragging={dragging || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onKeyDown={handleKeyDown}
    >
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line
          className="home-train-guide"
          x1={activeX}
          x2={activeX}
          y1={padTop}
          y2={height - padBottom}
        />
        <line
          className="home-train-threshold"
          x1={padLeft}
          x2={width - padRight}
          y1={targetY}
          y2={targetY}
        />
        <path className="home-train-curve" d={path} />
        {frames.map((frame, index) => (
          <circle
            key={frame.update}
            className="home-train-point"
            cx={toX(index)}
            cy={toY(frame.winnerFraction)}
            r={2}
            data-active={index === stepIndex || undefined}
            data-met={frame.winnerFraction >= FIRES || undefined}
          />
        ))}
        <circle
          className="home-train-cursor-halo"
          cx={activeX}
          cy={activeY}
          r={8}
          data-met={activeMet || undefined}
        />
        <circle
          className="home-train-cursor-ball"
          cx={activeX}
          cy={activeY}
          r={4.5}
          data-met={activeMet || undefined}
        />
      </svg>
      <span className="home-train-target-label" aria-hidden="true">90% target</span>
    </div>
  );
}

export function HomeTrainStage({ entries, approached, active, still, onNoReplay, onFocus }: {
  entries: readonly MaterialEntry[];
  approached: boolean;
  active: boolean;
  still: HomeStill;
  onNoReplay: () => void;
  onFocus?: (focus: ManifoldFocus) => void;
}) {
  const story = useLoaded(approached ? "home-train-story" : null, () => (approached ? loadHomeStory() : null));
  const stories = useMemo(
    () => (story.status === "ready" ? selectTrainStories(story.value.records) : []),
    [story],
  );

  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [stepState, setStepState] = useState<{ material: string; index: number } | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [accent, setAccent] = useState<string | null>(null);

  const record = stories.find((item) => item.material === selectedMaterial) ?? stories[0] ?? null;
  const fallbackEntry = entries[0] ?? null;
  const entry = record ? storyEntryForRecord(entries, record) : fallbackEntry;

  const frames = record?.training.frames ?? [];
  const lastIndex = Math.max(0, frames.length - 1);
  const stepIndex = record && stepState && stepState.material === record.material
    ? Math.min(Math.max(0, stepState.index), lastIndex)
    : lastIndex;
  const currentFrame = frames[stepIndex] ?? null;
  const lastFrame = frames[lastIndex] ?? null;
  const showLive = record !== null && stepIndex === lastIndex && !still && entry !== null;
  const needsLiveMaterial = approached && active && !still && (
    story.status === "failed" || (record !== null && stepIndex === lastIndex)
  );

  const material = usePublishedMaterial(needsLiveMaterial ? entry : null);
  const load4009 = needsLiveMaterial && entry?.id === "block-4009-figure-pyramid-strongest-seed-0";
  const recorded4009 = useLoaded(
    load4009 ? "home-train-4009-state" : null,
    () => (load4009 ? loadAutomatonState() : null),
  );
  const initialState = recorded4009.status === "ready" && entry?.id === recorded4009.value.replay.definition
    ? { tick: recorded4009.value.fine.tick, fine: recorded4009.value.fine.state, coarse: recorded4009.value.coarse.state }
    : undefined;
  const posterUrl = entry?.id === "block-4009-figure-pyramid-strongest-seed-0"
    ? `${AUTOMATON_RECORD_FOLDER}picture-128.png`
    : undefined;

  useEffect(() => {
    if (!active && replaying) setReplaying(false);
  }, [active, replaying]);

  useEffect(() => {
    if (replaying && stepIndex >= lastIndex) setReplaying(false);
  }, [replaying, stepIndex, lastIndex]);

  useEffect(() => {
    if (!replaying || !active || !record) return;
    const end = record.training.frames.length - 1;
    if (end <= 0) return;
    const timer = window.setInterval(() => {
      setStepState((previous) => {
        const current = previous && previous.material === record.material ? previous.index : 0;
        return { material: record.material, index: Math.min(end, current + 1) };
      });
    }, REPLAY_STEP_MS);
    return () => window.clearInterval(timer);
  }, [replaying, active, record]);

  const activeBlock = record?.block ?? fallbackEntry?.block ?? null;
  const reportedAccent = showLive ? accent : null;
  useEffect(() => {
    onFocus?.({ group: activeBlock, accent: reportedAccent });
  }, [onFocus, activeBlock, reportedAccent]);

  // Graceful fallback when `/story/story.json` is unavailable in minimal fixtures.
  if (story.status === "failed") {
    if (!fallbackEntry) {
      return (
        <div className="home-stage-frame home-train">
          <p className="muted">{WORDS.storyFailed}</p>
        </div>
      );
    }
    return (
      <div className="home-stage-frame home-train">
        <div className="home-train-fallback-player">
          <HomeMaterial
            key={fallbackEntry.id}
            entry={fallbackEntry}
            material={needsLiveMaterial && material.status === "ready" ? material.value : null}
            playing={active && !still}
            stepsPerSecond={HOME_TICKS_PER_SECOND}
            regrowAtTick={REGROW_AT_TICK}
            brushRing
            onAccent={setAccent}
            onNoReplay={onNoReplay}
          />
        </div>
        <MakerCard
          label={WORDS.plaqueLabel}
          block={fallbackEntry.block}
          title={fallbackEntry.title}
          definitionName={material.status === "ready" ? material.value.file.name : fallbackEntry.title}
          credit={fallbackEntry.credit ?? ""}
          detail={kindWords(fallbackEntry)}
          published
          accent={accent}
          action={
            <Link className="link-control" to={groupPath(fallbackEntry.block, fallbackEntry.id)}>
              {WORDS.openInAutomata}
            </Link>
          }
        />
      </div>
    );
  }

  if (!record || !currentFrame || !lastFrame) {
    return (
      <div className="home-stage-frame home-train">
        <div className="home-train-skeleton" aria-busy={approached} />
      </div>
    );
  }

  const storySegments = stories.map((candidate) => ({
    value: candidate.material,
    label: fill(WORDS.storyTab, { block: candidate.block }),
  }));
  const winsPercent = Math.round(currentFrame.winnerFraction * 100);

  const selectStory = (nextMaterial: string) => {
    setReplaying(false);
    setSelectedMaterial(nextMaterial);
    setStepState(null);
    setAccent(null);
  };

  const handleScrub = (nextIndex: number) => {
    setReplaying(false);
    setStepState({ material: record.material, index: nextIndex });
  };

  const replayTraining = () => {
    setStepState({ material: record.material, index: 0 });
    setReplaying(true);
  };

  return (
    <div className="home-stage-frame home-train">
      {storySegments.length > 1 && (
        <Segmented
          label={WORDS.storyChoiceName}
          segments={storySegments}
          value={record.material}
          onChange={selectStory}
        />
      )}

      <div className="home-properties-pair">
        <div className="home-properties-column">
          <span className="label">{WORDS.targetHeading}</span>
          <div className="home-train-anchor">
            <MarkedPatchPicture
              picture={{ imageId: record.anchor.imageId, slot: record.anchor.slot, band: 3 }}
              block={record.block}
            />
          </div>
        </div>

        <div className="home-properties-column">
          <span className="label">{WORDS.growingHeading}</span>
          <div className="home-train-growth">
            {showLive && entry ? (
              <HomeMaterial
                key={entry.id}
                entry={entry}
                material={needsLiveMaterial && material.status === "ready" ? material.value : null}
                initialState={initialState}
                posterUrl={posterUrl}
                playing={active && !still}
                stepsPerSecond={HOME_TICKS_PER_SECOND}
                regrowAtTick={REGROW_AT_TICK}
                brushRing
                onAccent={setAccent}
                onNoReplay={onNoReplay}
              />
            ) : (
              <div className="home-train-strip-frame">
                <img
                  className="home-train-strip"
                  src={`${STORY_FOLDER}${record.training.strip}`}
                  alt={fill(WORDS.stripAlt, { block: record.block, update: currentFrame.update })}
                  style={{
                    width: `${frames.length * 100}%`,
                    left: `${-stepIndex * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="home-train-controls">
        <SelectionSparkline
          frames={frames}
          stepIndex={stepIndex}
          accent={reportedAccent}
          onSelectStep={handleScrub}
        />
        <div className="home-train-readout-row">
          <span>
            {fill(WORDS.readout, {
              update: currentFrame.update.toLocaleString("en-US"),
              wins: winsPercent,
            })}
          </span>
          <button
            type="button"
            className="link-control home-train-replay"
            onClick={replayTraining}
          >
            <ResetMark />
            <span>{WORDS.replayTraining}</span>
          </button>
        </div>
      </div>

      <MakerCard
        label={WORDS.plaqueLabel}
        block={record.block}
        title={entry?.title ?? ""}
        definitionName={material.status === "ready" ? material.value.file.name : entry?.title}
        credit={entry?.credit ?? ""}
        detail={entry ? kindWords(entry) : null}
        updates={lastFrame.update}
        published
        accent={reportedAccent}
        action={
          <Link className="link-control" to={groupPath(record.block, entry?.id ?? null)}>
            {WORDS.openInAutomata}
          </Link>
        }
      />
    </div>
  );
}
