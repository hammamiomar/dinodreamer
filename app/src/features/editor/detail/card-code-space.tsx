// The request's 3-D code space shows recorded points, measured codes and their mean
// trail. Dragging the target ring snaps to a recorded token; Random token chooses one
// from the same cloud. Clicking a recorded point opens the basis group panel. The
// view accepts scroll only after a click engages it.

import { scaleCode } from "../../../code-target";
import { PaletteControls } from "./palette-controls";
import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import { useNavigate } from "react-router";
import { useLibrary } from "../../../app/library-session";
import type { Library } from "../../../library/library";
import type { Area, Request } from "../../../recipe";
import type { CodeMeasurement } from "../../../synthesis/protocol";
import { CodeSpace3D, type SpaceMark, type SpacePoint } from "../../../ui/code-space/code-space-3d";
import { basisGroupPath, PANEL_OPENED } from "../../look/basis-group-panel";
import { hasPaintedRespondArea } from "../model";
import { RING_LEGEND, detailCaption } from "../objective/legend";
import { formatNumber, palette, tokenLabel } from "../presentation";
import { codeStats, type Code } from "../readout/readout";
import type { EditorAction } from "../state";
import { pointToken, useBlockCloud } from "./block-cloud";
import { randomPoint, retargetAction } from "./retarget";
import { fillNodes } from "../../../app/fill-nodes";
import { fill } from "../../../app/site-words";
import { CREATE_TEXT } from "../create-text";

const WORDS = CREATE_TEXT.codeSpace;

/** The view's side: the card's width, at most this, so a phone's column fits it too. */
const MAX_VIEW_SIZE = 320;

export function CardCodeSpace({
  request,
  opened,
  ink,
  measurement,
  trail,
  dispatch,
}: {
  request: Request;
  opened: number;
  ink: string;
  /** The measured codes of the request's cells, when measured for this request. */
  measurement?: CodeMeasurement & { appliedField: Area };
  trail: Code[];
  dispatch: Dispatch<EditorAction>;
}) {
  const navigate = useNavigate();
  const library = useLibrary();
  const { target, radius } = request.respondLike;
  const requested = scaleCode(request.respondLike.code, radius);
  const painted = hasPaintedRespondArea(request.respondLike.source);
  const stats = measurement ? codeStats(measurement, requested, measurement.appliedField) : undefined;
  const cloud = useBlockCloud(request.block, request.respondLike.source);
  const fitTo = useFirstFit(request, requested);
  const marks = measuredMarks(measurement?.codes, ink);
  const move = useRetarget(library, request, opened, dispatch);
  const dots = painted ? WORDS.paintedDots : fill(WORDS.tokenDots, { token: tokenLabel(request.respondLike.source) });

  // A recorded point opens the basis group's panel over the Canvas (look/basis-group-panel.tsx).
  const openPoint = (key: string) => {
    if (!pointToken(key)) return;
    navigate(basisGroupPath("/create", "", request.block), { state: PANEL_OPENED });
  };

  return (
    <div className="card-code-space" title={detailCaption(request, painted)}>
      <PaletteControls request={request} cloud={cloud} dispatch={dispatch} />
      <CodeSpace3D
        points={cloud}
        fitTo={fitTo}
        marks={marks}
        // The token's code is the ring the visitor drags; while a move reads its token's blocks, it waits on the new point.
        dragMark={target.kind === "point" ? { code: move.pending?.code ?? requested, colour: ink, onDrop: (key) => move.to(cloud.find((point) => point.key === key)) } : undefined}
        targetHandles={target.kind === "point" ? undefined : {
          target, colour: ink, onChange: (target) => dispatch({ type: "setCodeTarget", requestId: request.id, target }),
        }}
        trail={{ codes: trail, colour: ink }}
        // Recorded tokens are the neighbourhood, drawn quietly behind the request's own codes.
        pointColour={palette().faint}
        orientationKey={false}
        size={MAX_VIEW_SIZE}
        onSelect={openPoint}
        label={fill(WORDS.name, { block: request.block })}
      />
      <p className="card-code-line label">
        <span>
          {dots} · {target.kind === "point" ? fill(WORDS.dragPoint, { legend: RING_LEGEND }) : WORDS.dragRings}
        </span>
        <span className="card-code-distance">
          {fillNodes(WORDS.distance, {
            distance: <b className="mono">{stats ? formatNumber(stats.distance) : "—"}</b>,
            spread: <b className="mono">{stats ? formatNumber(stats.spread) : "—"}</b>,
          })}
        </span>
      </p>
      {target.kind === "point" && <div className="card-code-actions">
        <button
          type="button"
          className="chip"
          title={fill(WORDS.randomTitle, { block: request.block })}
          disabled={cloud.length < 2}
          onClick={() => move.to(randomPoint(cloud, request))}
        >
          {WORDS.random}
        </button>
        {move.failure && <span className="label card-code-failure">{move.failure}</span>}
      </div>}
    </div>
  );
}

/**
 * The codes the view fits besides the cloud: the token's code it first showed for this block
 * and cloud (role, and slot for a storage token). Measured codes move inside that fit, and so
 * does a target moved along the cloud: the first token's code can lie outside the cloud, so
 * fitting the current code would refit the view at the first move.
 */
function useFirstFit(request: Request, requested: Code): Code[] {
  const { role, slot } = request.respondLike.source;
  const cloudOf = `${request.block}:${role}:${role === "storage" ? slot : ""}`;
  // Hold the first requested code per cloud in a ref so React never evicts it like useMemo.
  const first = useRef<{ cloudOf: string; codes: Code[] } | null>(null);
  if (first.current?.cloudOf !== cloudOf) {
    first.current = { cloudOf, codes: [requested] };
  }
  return first.current.codes;
}

/**
 * Moves the request's target to a point of the cloud (retarget.ts). One move counts at a time:
 * a move that finishes after a newer one began is dropped, so the last drop wins.
 */
function useRetarget(library: Library, request: Request, opened: number, dispatch: Dispatch<EditorAction>) {
  const [pending, setPending] = useState<SpacePoint | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    setPending(null);
    setFailure(null);
    return () => { latest.current++; };
  }, [opened, request.respondLike.source, request.respondLike.target]);
  const to = (point: SpacePoint | null | undefined) => {
    if (!point) return;
    const move = ++latest.current;
    setPending(point);
    setFailure(null);
    retargetAction(library, request, point, opened)
      .then(
        (action) => {
          if (move === latest.current && action) dispatch(action);
        },
        () => {
          if (move === latest.current) setFailure(WORDS.moveFailed);
        },
      )
      .finally(() => {
        if (move === latest.current) setPending(null);
      });
  };
  return { pending, failure, to };
}

/** Each measured code as a dot; the token's code is the dragged ring, which the view draws. */
function measuredMarks(codes_P3: Float32Array | undefined, ink: string): SpaceMark[] {
  const marks: SpaceMark[] = [];
  if (codes_P3) {
    for (let token = 0; token < codes_P3.length / 3; token++) {
      const code: Code = [codes_P3[token * 3], codes_P3[token * 3 + 1], codes_P3[token * 3 + 2]];
      marks.push({ code, shape: "dot", colour: ink });
    }
  }
  return marks;
}
