// Palette selectors in the same coordinates as the code cloud. The caller owns edits.
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Code, CodeTarget } from "../../recipe";
import { squaredDistance } from "../../code-target";
import type { SpacePoint } from "./code-space-3d";
import type { Vec3 } from "./projection";

export interface TargetHandles {
  target: Exclude<CodeTarget, { kind: "point" }>;
  colour: string;
  onChange(target: Exclude<CodeTarget, { kind: "point" }>): void;
}

export function TargetOverlay({ handles, points, project, scale, size }: {
  handles: TargetHandles;
  points: readonly SpacePoint[];
  project(code: Vec3): { x: number; y: number };
  scale: number;
  size: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ handle: "radius" | 0 | 1; value: TargetHandles["target"] } | null>(null);
  const [preview, setPreview] = useState<TargetHandles["target"] | null>(null);
  const target = preview ?? handles.target;
  const cancel = () => { drag.current = null; setPreview(null); };
  useEffect(() => {
    if (!preview) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [preview]);

  const begin = (event: PointerEvent<SVGCircleElement>, handle: "radius" | 0 | 1) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, value: handles.target };
    setPreview(handles.target);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || !svg.current) return;
    const rect = svg.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) * size / rect.width;
    const y = (event.clientY - rect.top) * size / rect.height;
    const value = current.value;
    if (current.handle === "radius" && value.kind === "region") {
      const centre = project(value.centre);
      current.value = { ...value, selectionRadius: Math.max(1e-4, Math.hypot(x - centre.x, y - centre.y) / scale) };
    } else if (current.handle !== "radius" && points.length > 0) {
      const nearest = points.reduce((best, point) => {
        const at = project(point.code);
        const distance = (x - at.x) ** 2 + (y - at.y) ** 2;
        return distance < best.distance ? { point, distance } : best;
      }, { point: points[0]!, distance: Infinity }).point;
      current.value = movedEndpoint(value, current.handle, [...nearest.code]);
    }
    setPreview(current.value);
  };
  const finish = () => {
    if (drag.current) handles.onChange(drag.current.value);
    cancel();
  };
  const ring = (code: Code, endpoint: 0 | 1, label: string) => {
    const at = project(code);
    return <g key={endpoint}>
      <circle cx={at.x} cy={at.y} r={8} fill="var(--scrim)" fillOpacity={0.65} stroke={handles.colour} strokeWidth={2}
        className="code-target-handle" tabIndex={0} role="button" aria-label={`Move ${label}`}
        onPointerDown={(event) => begin(event, endpoint)}
        onKeyDown={(event) => {
          if (!event.key.startsWith("Arrow") || points.length === 0) return;
          event.preventDefault();
          const index = points.findIndex((point) => squaredDistance(point.code, code) < 1e-12);
          const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
          const point = points[(index + delta + points.length) % points.length]!;
          handles.onChange(movedEndpoint(handles.target, endpoint, [...point.code]));
        }} />
      <text x={at.x + 11} y={at.y - 9} fill={handles.colour} fontSize={11}>{label}</text>
    </g>;
  };
  const centre = target.kind === "region" ? project(target.centre) : null;
  const radius = target.kind === "region" ? target.selectionRadius * scale : 0;
  return <svg ref={svg} className="code-target-overlay" viewBox={`0 0 ${size} ${size}`}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} aria-label="Palette target handles">
    {target.kind === "path" && <>
      <line x1={project(target.codes[0]).x} y1={project(target.codes[0]).y} x2={project(target.codes[1]).x} y2={project(target.codes[1]).y} stroke={handles.colour} />
      {ring(target.codes[0], 0, "A")}{ring(target.codes[1], 1, "B")}
    </>}
    {target.kind === "region" && centre && <>
      <circle cx={centre.x} cy={centre.y} r={radius} fill={handles.colour} fillOpacity={0.06} stroke={handles.colour} />
      <ellipse cx={centre.x} cy={centre.y} rx={radius} ry={radius / 3} fill="none" stroke={handles.colour} opacity={0.35} />
      <ellipse cx={centre.x} cy={centre.y} rx={radius / 3} ry={radius} fill="none" stroke={handles.colour} opacity={0.35} />
      {points.filter((point) => squaredDistance(point.code, target.centre) <= target.selectionRadius ** 2).map((point) => {
        const at = project(point.code);
        return <circle key={point.key} cx={at.x} cy={at.y} r={2.5} fill={handles.colour} />;
      })}
      {ring(target.centre, 0, "centre")}
      <circle cx={centre.x + radius} cy={centre.y} r={6} fill="var(--scrim)" stroke={handles.colour} strokeWidth={2}
        className="code-target-handle" tabIndex={0} role="slider" aria-label="Response selection radius" aria-valuenow={target.selectionRadius}
        aria-valuemin={0.0001} onPointerDown={(event) => begin(event, "radius")}
        onKeyDown={(event) => {
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault();
          const multiplier = event.key === "ArrowLeft" || event.key === "ArrowDown" ? 0.9 : 1.1;
          handles.onChange({ ...target, selectionRadius: Math.max(0.0001, target.selectionRadius * multiplier) });
        }} />
    </>}
  </svg>;
}

function movedEndpoint(target: TargetHandles["target"], endpoint: 0 | 1, code: Code): TargetHandles["target"] {
  if (target.kind === "region") return { ...target, centre: code };
  const codes: [Code, Code] = [...target.codes];
  codes[endpoint] = code;
  return { ...target, codes };
}
