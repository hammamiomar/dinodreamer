// The model map: the architecture drawing available through the whole story. Rectangles
// and arrows, drawn for the stages a section has reached and no others, so the map is always
// centred on what exists: act 1 is four boxes, act 2 six, act 3 the whole loop. Every stage keeps
// its own element across sections, so when the story adds a stage the boxes already there slide
// to make room and the new one grows out of the neighbour it attaches to. The stages a section is
// about are lit; where a section shows the signal, the forward path and the return path run.
// Clicking a stage leads to the section that explains it. Geometry is in CSS pixels; when the map
// is wider than its box it folds into two rows that read as a loop (the first row left to right,
// the second under it right to left, so the return from the loss to the automaton is one short
// arrow up), and when even that is wider than the box the drawing scales down. On mobile,
// the expanded illustration uses a horizontal strip and scrolls the selected stage into view.
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { SITE_WORDS } from "../../app/site-words";
import { HOW_STAGES, type HowMapState, type HowStage } from "./how-sections";
import "./how-map.css";

const WORDS = SITE_WORDS.how.map;

/** Each stage's box width; the heights and the rows are shared. */
const STAGE_WIDTH: Record<HowStage, number> = {
  automaton: 96, picture: 96, patches: 96, dino: 96, tokens: 88, basis: 136, responses: 96, loss: 72,
};
const GAP = 20;
const BOX_HEIGHT = 56;
const TOP = 8;
/** Between the two rows of the folded map: room for the arrow that crosses. */
const ROW_GAP = 40;
const MARGIN = 8;
/** Under the one row: the lane of the return path. */
const RETURN_LANE = 32;
/** How small an absent stage waits inside its neighbour before it grows out. */
const ABSENT_SCALE = 0.6;

export interface StageBox { stage: HowStage; x: number; y: number; width: number; row: 0 | 1 }
export interface MapLayout { boxes: StageBox[]; width: number; height: number; rows: 1 | 2 }

/**
 * The present stages placed, in the map's order: one row left to right, or, folded, the first
 * half across the top and the rest back under it from the right, so the path turns at the end
 * of the row. Each column is as wide as the wider of its two boxes.
 */
export function mapLayout(present: readonly HowStage[], rows: 1 | 2): MapLayout {
  const stages = HOW_STAGES.filter((stage) => present.includes(stage));
  const returns = stages.includes("loss") && stages.includes("automaton");
  if (rows === 1) {
    let x = MARGIN;
    const boxes = stages.map((stage): StageBox => {
      const box: StageBox = { stage, x, y: TOP, width: STAGE_WIDTH[stage], row: 0 };
      x += box.width + GAP;
      return box;
    });
    return { boxes, width: x - GAP + MARGIN, height: TOP + BOX_HEIGHT + (returns ? RETURN_LANE : 0) + MARGIN, rows };
  }
  const columns = Math.ceil(stages.length / 2);
  const top = stages.slice(0, columns);
  const bottom: (HowStage | null)[] = Array.from({ length: columns }, () => null);
  stages.slice(columns).forEach((stage, at) => { bottom[columns - 1 - at] = stage; });
  let x = MARGIN;
  const placed = new Map<HowStage, StageBox>();
  for (let column = 0; column < columns; column++) {
    const upper = top[column]!;
    const lower = bottom[column];
    const width = Math.max(STAGE_WIDTH[upper], lower ? STAGE_WIDTH[lower] : 0);
    placed.set(upper, { stage: upper, x, y: TOP, width, row: 0 });
    if (lower) placed.set(lower, { stage: lower, x, y: TOP + BOX_HEIGHT + ROW_GAP, width, row: 1 });
    x += width + GAP;
  }
  const boxes = stages.map((stage) => placed.get(stage)!);
  return { boxes, width: x - GAP + MARGIN, height: TOP + 2 * BOX_HEIGHT + ROW_GAP + MARGIN, rows };
}

/**
 * Where an absent stage waits: inside the nearest present stage before it in the map's order,
 * else the nearest after it. That is the neighbour it will attach to when the story adds it.
 */
export function anchorOf(stage: HowStage, present: readonly HowStage[]): HowStage | null {
  const at = HOW_STAGES.indexOf(stage);
  for (let before = at - 1; before >= 0; before--) if (present.includes(HOW_STAGES[before]!)) return HOW_STAGES[before]!;
  for (let after = at + 1; after < HOW_STAGES.length; after++) if (present.includes(HOW_STAGES[after]!)) return HOW_STAGES[after]!;
  return null;
}

/** The arrow from one present stage to the next: along a row, or down from the first row to the second. */
export function arrowBetween(from: StageBox, to: StageBox): { x1: number; y1: number; x2: number; y2: number } {
  if (from.row === to.row) {
    const y = from.y + BOX_HEIGHT / 2;
    return from.row === 0
      ? { x1: from.x + from.width, y1: y, x2: to.x, y2: y }
      : { x1: from.x, y1: y, x2: to.x + to.width, y2: y };
  }
  const x = from.x + from.width / 2;
  return { x1: x, y1: from.y + BOX_HEIGHT, x2: to.x + to.width / 2, y2: to.y };
}

/** The return path, from the loss back to the automaton: under the one row, or straight up between the two. */
export function returnPath(from: StageBox, to: StageBox): string {
  if (from.row === to.row) {
    const under = from.y + BOX_HEIGHT + RETURN_LANE - 8;
    return `M${from.x + from.width / 2} ${from.y + BOX_HEIGHT} V${under} H${to.x + to.width / 2} V${to.y + BOX_HEIGHT + 1}`;
  }
  return `M${from.x + from.width / 2} ${from.y} V${to.y + BOX_HEIGHT + 1}`;
}

/** A present stage's place, or an absent one's waiting place inside its anchor, as a CSS transform. */
function stageTransform(stage: HowStage, layout: MapLayout, present: readonly HowStage[]): string {
  const own = layout.boxes.find((box) => box.stage === stage);
  if (own) return `translate(${own.x}px, ${own.y}px)`;
  const anchor = anchorOf(stage, present);
  const home = anchor ? layout.boxes.find((box) => box.stage === anchor) : undefined;
  if (!home) return `translate(${MARGIN}px, ${TOP}px) scale(${ABSENT_SCALE})`;
  const x = home.x + home.width / 2 - (ABSENT_SCALE * STAGE_WIDTH[stage]) / 2;
  const y = home.y + BOX_HEIGHT / 2 - (ABSENT_SCALE * BOX_HEIGHT) / 2;
  return `translate(${x}px, ${y}px) scale(${ABSENT_SCALE})`;
}

interface HowMapProps {
  state: HowMapState;
  /** A basis group to mark inside the basis box, as a dot in a tiny field, or null. */
  litGroup: number | null;
  onSelect: (stage: HowStage) => void;
}

/** Both arrangements retain their stage elements. CSS exposes the one that fits the map container. */
export function HowMap(props: HowMapProps) {
  const navigation = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const selected = props.state.lit[0] ?? props.state.present[0];

  useLayoutEffect(() => {
    const outer = navigation.current!;
    const element = container.current!;
    const measure = () => {
      const distance = element.scrollWidth - element.clientWidth;
      setOverflow(window.matchMedia("(max-width: 1023px)").matches && distance > 1);
      outer.style.setProperty("--map-visible", String(element.clientWidth / Math.max(1, element.scrollWidth)));
      outer.style.setProperty("--map-position", String(distance > 0 ? element.scrollLeft / distance : 0));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [props.state.present.length]);

  useLayoutEffect(() => {
    const element = container.current!;
    const revealSelected = () => {
      if (element.scrollWidth <= element.clientWidth) return;
      const stage = element.querySelector<SVGGElement>(`.how-map[data-rows="1"] [data-stage="${selected}"]`);
      if (!stage) return;
      const bounds = element.getBoundingClientRect();
      const target = stage.getBoundingClientRect();
      // Move only the map's horizontal scroll. The page keeps its reading position.
      const offset = target.left < bounds.left ? target.left - bounds.left : Math.max(0, target.right - bounds.right);
      if (offset !== 0) element.scrollTo({ left: element.scrollLeft + offset, behavior: "instant" });
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected, props.state.present.length, overflow]);

  return (
    <div ref={navigation} className="how-map-navigation" data-overflow={overflow}>
      <div ref={container} className="how-map-box" data-count={props.state.present.length}>
        <MapDrawing {...props} rows={1} />
        <MapDrawing {...props} rows={2} />
      </div>
      <div className="how-map-progress" aria-hidden="true"><span /></div>
    </div>
  );
}

function MapDrawing({ state, litGroup, onSelect, rows }: HowMapProps & { rows: 1 | 2 }) {
  const layout = mapLayout(state.present, rows);
  const arrowId = useId();
  const first = layout.boxes[0];
  const last = layout.boxes[layout.boxes.length - 1];
  const returns = state.present.includes("loss") && state.present.includes("automaton");
  const size = { "--map-width": `${layout.width}px`, "--map-height": `${layout.height}px` } as CSSProperties;
  return (
    <svg className="how-map" data-rows={rows} viewBox={`0 0 ${layout.width} ${layout.height}`} style={size} role="group" aria-label={WORDS.name} data-signal={state.signal || undefined}>
      <defs>
        <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0.5 L7 4 L0 7.5" fill="none" stroke="currentColor" strokeWidth="1" />
        </marker>
      </defs>
      {/* The forward path: an arrow from each present stage to the next. Each arrow is placed by a transform, so it slides with its stages. */}
      {layout.boxes.slice(1).map((box, at) => {
        const from = layout.boxes[at]!;
        const line = arrowBetween(from, box);
        return (
          <g key={`${from.stage}-${box.stage}-${layout.rows}`} className="how-map-arrow" style={{ transform: `translate(${line.x1}px, ${line.y1}px)` }}>
            <line x1={0} y1={0} x2={line.x2 - line.x1} y2={line.y2 - line.y1} markerEnd={`url(#${arrowId})`} />
          </g>
        );
      })}
      {/* The return path: from the loss back into the automaton. */}
      {returns && first && last && <path key={layout.rows} className="how-map-return" d={returnPath(last, first)} markerEnd={`url(#${arrowId})`} />}
      {/* Every stage, present or waiting inside its neighbour, so a stage the story adds grows out of the map it joins. */}
      {HOW_STAGES.map((stage) => {
        const shown = state.present.includes(stage);
        const lit = state.lit.includes(stage);
        const width = layout.boxes.find((box) => box.stage === stage)?.width ?? STAGE_WIDTH[stage];
        const textX = stage === "basis" ? width / 2 - 12 : width / 2;
        const title = WORDS.stages[stage].split("\n");
        return (
          <g
            key={stage}
            className="how-map-stage"
            data-stage={stage}
            data-present={shown || undefined}
            data-lit={lit || undefined}
            style={{ transform: stageTransform(stage, layout, state.present) }}
            role="button"
            tabIndex={shown ? 0 : -1}
            aria-label={WORDS.open.replace("{stage}", title.join(" "))}
            aria-hidden={!shown || undefined}
            onClick={() => shown && onSelect(stage)}
            onKeyDown={(event) => { if (shown && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(stage); } }}
          >
            <rect x={0.5} y={0.5} width={width - 1} height={BOX_HEIGHT - 1} />
            {/* A name written on two lines in the words wraps inside the box. */}
            <text className="how-map-title" x={textX} y={title.length > 1 ? 18 : 24} textAnchor="middle">
              {title.map((line, at) => <tspan key={at} x={textX} dy={at === 0 ? 0 : 13}>{line}</tspan>)}
            </text>
            <text className="how-map-detail" x={textX} y={44} textAnchor="middle">{WORDS.details[stage]}</text>
            {stage === "basis" && litGroup !== null && <GroupMark width={width} group={litGroup} />}
          </g>
        );
      })}
    </svg>
  );
}

/** The lit group's place inside the basis box: the 16,384 groups as a 128 × 128 field scaled to a small square at the box's right. */
function GroupMark({ width, group }: { width: number; group: number }) {
  const side = 16;
  const x = width - side - 6;
  const y = 6;
  const column = group % 128;
  const row = Math.floor(group / 128);
  return (
    <g className="how-map-group" aria-hidden="true">
      <rect x={x + 0.5} y={y + 0.5} width={side - 1} height={side - 1} />
      <rect x={x + (column / 128) * side - 1} y={y + (row / 128) * side - 1} width={2} height={2} />
    </g>
  );
}
