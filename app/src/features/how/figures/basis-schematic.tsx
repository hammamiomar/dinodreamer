// Where the basis sits and what it is, as a drawing with no data: a token read by a sparse
// autoencoder (one number per feature) beside the same token read by the block sparse featurizer
// (three numbers per group, a point in a small space). Two equal panes, each a drawing with its
// title above and its note below, so the pair sits centred like every other figure.
import { SITE_WORDS } from "../../../app/site-words";
import { FigureCaption } from "./figure-caption";

const WORDS = SITE_WORDS.how.figures;
const CAPTIONS = [WORDS.saeNote, WORDS.bsfNote];
/** Each pane's drawing space. */
const VIEW = { width: 320, height: 192 };

/** The token: a column of ticks standing for 768 numbers, at the pane's left. */
function Token() {
  const ticks = Array.from({ length: 22 }, (_, index) => index);
  return (
    <g className="how-schematic-token">
      <rect x={24.5} y={16.5} width={23} height={159} />
      {ticks.map((tick) => <line key={tick} x1={30} x2={30 + 4 + ((tick * 7) % 9)} y1={22 + tick * 7} y2={22 + tick * 7} />)}
      <text x={36} y={189} textAnchor="middle">{WORDS.tokenLabel}</text>
    </g>
  );
}

/** A group's three axes with a point, lit or not. */
function Group({ x, y, lit }: { x: number; y: number; lit: boolean }) {
  return (
    <g className="how-schematic-group" data-lit={lit || undefined} transform={`translate(${x} ${y})`}>
      <line x1={-18} x2={18} y1={6} y2={-6} />
      <line x1={0} x2={0} y1={-20} y2={16} />
      <line x1={-14} x2={14} y1={-12} y2={12} />
      {lit && <circle cx={9} cy={-7} r={3.5} />}
    </g>
  );
}

function SparseAutoencoder() {
  const features = Array.from({ length: 12 }, (_, index) => index);
  const lit: Record<number, string> = { 2: "0.8", 5: "2.3", 9: "1.1" };
  return (
    <svg className="how-schematic" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-hidden="true">
      <Token />
      {features.map((feature) => {
        const y = 24 + feature * 13;
        const isLit = feature in lit;
        return (
          <g key={feature} className="how-schematic-feature" data-lit={isLit || undefined}>
            <line x1={48} x2={200} y1={96} y2={y + 5} />
            <rect x={200.5} y={y + 0.5} width={9} height={9} />
            {isLit && <text x={218} y={y + 9}>{lit[feature]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function BlockSparseFeaturizer() {
  const groups = [0, 1, 2, 3];
  return (
    <svg className="how-schematic" viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-hidden="true">
      <Token />
      {groups.map((group) => {
        const y = 40 + group * 40;
        const lit = group === 1;
        return (
          <g key={group} data-lit={lit || undefined} className="how-schematic-feature">
            <line x1={48} x2={124} y1={96} y2={y} />
            <Group x={150} y={y} lit={lit} />
            {lit && <text x={178} y={y + 4}>(−10.3, −7.6, 0.0)</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** The two drawings share the same CSS-sized panes. */
export function BasisSchematic() {
  return (
    <div className="how-pair how-schematic-pair" role="img" aria-label={WORDS.schematicName}>
      <figure className="how-pane">
        <p className="how-figure-line">{WORDS.saeTitle}</p>
        <div className="how-visual">
          <SparseAutoencoder />
        </div>
        <FigureCaption reserve={CAPTIONS}>{WORDS.saeNote}</FigureCaption>
      </figure>
      <figure className="how-pane">
        <p className="how-figure-line">{WORDS.bsfTitle}</p>
        <div className="how-visual">
          <BlockSparseFeaturizer />
        </div>
        <FigureCaption reserve={CAPTIONS}>{WORDS.bsfNote}</FigureCaption>
      </figure>
    </div>
  );
}
