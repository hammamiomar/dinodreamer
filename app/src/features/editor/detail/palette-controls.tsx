import { useEffect, useState, type Dispatch } from "react";
import type { Code, CodeTarget, Request } from "../../../recipe";
import { DEFAULT_REGION_COVERAGE } from "../../../recipe";
import { squaredDistance } from "../../../code-target";
import type { SpacePoint } from "../../../ui/code-space/code-space-3d";
import type { EditorAction } from "../state";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";

const WORDS = CREATE_TEXT.palette;

/** The recipe owns selectors and scale. The cloud supplies recorded endpoint choices. */
export function PaletteControls({ request, cloud, dispatch }: {
  request: Request;
  cloud: SpacePoint[];
  dispatch: Dispatch<EditorAction>;
}) {
  const { target, radius, code, source } = request.respondLike;
  const change = (target: CodeTarget) => dispatch({ type: "setCodeTarget", requestId: request.id, target });
  const choose = (kind: CodeTarget["kind"]) => {
    if (kind === target.kind) return;
    if (kind === "point") change({ kind });
    if (kind === "region") change({ kind, centre: [...code], selectionRadius: Math.max(0.1, Math.hypot(...code) / 4), lambda: DEFAULT_REGION_COVERAGE });
    if (kind === "path") {
      const second = cloud.find((point) => squaredDistance(point.code, code) > 0.25)?.code ?? code;
      change({ kind, codes: [[...code], [...second] as Code], anchors: [7 * 16 + 3, 7 * 16 + 12] });
    }
  };
  const selected = target.kind === "region"
    ? cloud.filter((point) => squaredDistance(point.code, target.centre) <= target.selectionRadius ** 2).length
    : 0;
  return <div className="palette-controls">
    <div className="card-code-actions" aria-label={WORDS.kindName}>
      {(["point", "path", "region"] as const).map((kind) => <button type="button" className="chip" key={kind}
        aria-pressed={target.kind === kind} disabled={source.role !== "patch" && kind !== "point"} onClick={() => choose(kind)}>
        {WORDS.kinds[kind]}
      </button>)}
      <span className="label">{target.kind} · ×{radius}</span>
    </div>
    <label className="palette-radius label">{fill(WORDS.radius, { radius })}
      <input aria-label={WORDS.radiusName} type="range" min={0.5} max={8} step={0.25} value={radius}
        onChange={(event) => dispatch({ type: "setCodeRadius", requestId: request.id, radius: Number(event.target.value) })} />
    </label>
    {target.kind === "region" && <>
      <div className="card-code-actions label">
        <label>{WORDS.selectionRadius} <TargetNumberInput label={WORDS.selectionRadiusName} min={0.0001} step={0.1}
          value={target.selectionRadius} onCommit={(selectionRadius) => change({ ...target, selectionRadius })} /></label>
        <label>{WORDS.coverage} <TargetNumberInput label={WORDS.coverageName} min={0} step={0.25} value={target.lambda}
          onCommit={(lambda) => change({ ...target, lambda })} /></label>
      </div>
      <p className="label">{fill(WORDS.recorded, { selected, points: cloud.length.toLocaleString("en-US") })}</p>
    </>}
    {target.kind === "path" && <div className="card-code-actions">
      {([0, 1] as const).map((endpoint) => <button className="chip" type="button" key={endpoint}
        onClick={() => dispatch({ type: "pickPathAnchor", requestId: request.id, endpoint })}>
        {fill(WORDS.pickAnchor, { endpoint: endpoint === 0 ? "A" : "B", row: Math.floor(target.anchors[endpoint] / 16) + 1, column: target.anchors[endpoint] % 16 + 1 })}
      </button>)}
    </div>}
  </div>;
}

/** Keep partial input local so clearing a field cannot invalidate the running recipe. */
function TargetNumberInput({ label, min, step, value, onCommit }: {
  label: string;
  min: number;
  step: number;
  value: number;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((text) => text.trim() !== "" && Number(text) === value ? text : String(value));
  }, [value]);
  return <input aria-label={label} type="number" min={min} step={step} value={draft}
    onChange={(event) => {
      const text = event.currentTarget.value;
      setDraft(text);
      const number = Number(text);
      if (text.trim() !== "" && Number.isFinite(number) && number >= min && number !== value) onCommit(number);
    }}
    onBlur={() => setDraft(String(value))} />;
}
