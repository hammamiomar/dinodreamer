// Shared interactive, gently auto-rotating 3-D response space canvas.
// Used on Home Beat 2 and on every visible /index basis-group card.
//
// All active visible instances share a single module-level requestAnimationFrame ticker that
// stops completely when no instance is visible or when prefers-reduced-motion is enabled.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { AtlasBand, AtlasCloud } from "../library/atlas-cloud";
import { bandColours } from "../features/look/strength-bands";
import {
  CLICK_TOLERANCE_PX,
  DEFAULT_ORBIT,
  depthOrder,
  fitCodes,
  orbitBy,
  projector,
  type Orbit,
  type Vec3,
} from "./code-space/projection";
import { canvasPixelRatio, pagePointer, pageScale } from "./page-scale";
import { usePrefersReducedMotion } from "./tween";

const SPHERE_SEGMENTS = 48;
const AUTO_YAW_RAD_PER_SEC = 0.22;
const KEY_ORBIT_STEP_PX = 20;

type TickSubscriber = (dt: number) => void;
const tickSubscribers = new Set<TickSubscriber>();
let sharedRafId = 0;
let sharedLastTime: number | null = null;

function runSharedTick(now: number): void {
  sharedRafId = 0;
  if (tickSubscribers.size === 0) {
    sharedLastTime = null;
    return;
  }
  if (sharedLastTime !== null) {
    const dt = Math.min(0.064, Math.max(0, (now - sharedLastTime) / 1000));
    for (const subscriber of tickSubscribers) subscriber(dt);
  }
  sharedLastTime = now;
  if (tickSubscribers.size > 0) {
    sharedRafId = window.requestAnimationFrame(runSharedTick);
  } else {
    sharedLastTime = null;
  }
}

function subscribeSharedTicker(subscriber: TickSubscriber): () => void {
  tickSubscribers.add(subscriber);
  if (sharedRafId === 0) {
    sharedLastTime = null;
    sharedRafId = window.requestAnimationFrame(runSharedTick);
  }
  return () => {
    tickSubscribers.delete(subscriber);
    if (tickSubscribers.size === 0 && sharedRafId !== 0) {
      window.cancelAnimationFrame(sharedRafId);
      sharedRafId = 0;
      sharedLastTime = null;
    }
  };
}

interface Prepared3DCloud {
  readonly codes: readonly Vec3[];
  readonly bands: readonly AtlasBand[];
  readonly gateRadius: number;
  readonly axisExtent: number;
}

/** Build 3-D coordinates, response levels, and framing extents directly from a compact AtlasCloud record. */
export function prepare3DCloud(cloud: AtlasCloud): Prepared3DCloud {
  const codes: Vec3[] = [];
  const bands: AtlasBand[] = [];
  let maxNorm = Math.max(cloud.maximum, cloud.ring);
  for (const point of cloud.nativePoints) {
    const [x, y, z] = point.code;
    const norm = Math.hypot(x, y, z);
    codes.push([x, y, z]);
    bands.push(point.band);
    if (norm > maxNorm) maxNorm = norm;
  }
  return {
    codes,
    bands,
    gateRadius: cloud.ring,
    axisExtent: Math.max(maxNorm * 0.92, cloud.ring * 1.35, 1),
  };
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  orbiting: boolean;
}

/**
 * Interactive 3-D response cloud with native basis-group axes, three orthogonal median-sphere great circles,
 * and depth-sorted strength-coloured patch codes. Supports orbit gestures while preserving short
 * clicks so parent links (such as BasisGroupLink on /index) still open on click.
 */
export function RotatingCloud3D({
  cloud,
  highlight = null,
  active = true,
  height,
  initialYawOffset = 0,
  ariaLabel,
}: {
  cloud: AtlasCloud;
  highlight?: AtlasBand | null;
  /** Whether auto-rotation should run when in viewport. */
  active?: boolean;
  /** Optional explicit CSS height in px (e.g. 208 on Home); when omitted, fills parentElement height. */
  height?: number;
  /** Subtle phase/yaw offset (e.g. from block id) or 0. */
  initialYawOffset?: number;
  ariaLabel?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbitRef = useRef<Orbit>({ ...DEFAULT_ORBIT, yaw: DEFAULT_ORBIT.yaw + initialYawOffset });
  const lastCloudRef = useRef<AtlasCloud>(cloud);
  const lastYawOffsetRef = useRef<number>(initialYawOffset);
  const dragRef = useRef<DragState | null>(null);
  const draggedRef = useRef(false);
  const dragRafRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const [dragging, setDragging] = useState(false);
  const [inViewport, setInViewport] = useState(false);

  const prepared = useMemo(() => prepare3DCloud(cloud), [cloud]);
  const fit = useMemo(() => {
    const e = prepared.axisExtent;
    const fitPoints: Vec3[] = [
      ...prepared.codes,
      [-e, 0, 0], [e, 0, 0],
      [0, -e, 0], [0, e, 0],
      [0, 0, -e], [0, 0, e],
    ];
    return { center: [0, 0, 0] as Vec3, radius: fitCodes(fitPoints).radius };
  }, [prepared]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;

    if (lastCloudRef.current !== cloud || lastYawOffsetRef.current !== initialYawOffset) {
      orbitRef.current = { ...DEFAULT_ORBIT, yaw: DEFAULT_ORBIT.yaw + initialYawOffset };
      lastCloudRef.current = cloud;
      lastYawOffsetRef.current = initialYawOffset;
    }

    const styles = getComputedStyle(canvas);
    const lineColour = styles.getPropertyValue("--line-2").trim() || "#2e2c2a";
    const ringColour = styles.getPropertyValue("--ink-3").trim() || "#5e5b57";
    const colours = bandColours();

    const draw = () => {
      const scale = pageScale(canvas);
      const rect = box.getBoundingClientRect();
      const width = rect.width / scale;
      const drawHeight = height !== undefined ? height : rect.height / scale;
      if (width <= 0 || drawHeight <= 0) return;

      const dpr = canvasPixelRatio(canvas, 2);
      const targetW = Math.max(1, Math.round(width * dpr));
      const targetH = Math.max(1, Math.round(drawHeight * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, drawHeight);

      const project = projector({ fit, orbit: orbitRef.current, width, height: drawHeight });

      // 1. Principal 3-D coordinate axes through the origin.
      const e = prepared.axisExtent;
      const axes: readonly [Vec3, Vec3][] = [
        [[-e, 0, 0], [e, 0, 0]],
        [[0, -e, 0], [0, e, 0]],
        [[0, 0, -e], [0, 0, e]],
      ];
      ctx.strokeStyle = lineColour;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (const [from, to] of axes) {
        const a = project(from);
        const b = project(to);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      // 2. Three orthogonal great circles of the 3-D median threshold sphere.
      const r = prepared.gateRadius;
      ctx.strokeStyle = ringColour;
      ctx.lineWidth = 0.9;
      for (let plane = 0; plane < 3; plane++) {
        ctx.globalAlpha = plane === 0 ? 0.65 : 0.32;
        ctx.beginPath();
        for (let step = 0; step <= SPHERE_SEGMENTS; step++) {
          const theta = (step / SPHERE_SEGMENTS) * Math.PI * 2;
          const c = Math.cos(theta) * r;
          const s = Math.sin(theta) * r;
          const point3D: Vec3 = plane === 0 ? [c, s, 0] : plane === 1 ? [c, 0, s] : [0, c, s];
          const p = project(point3D);
          if (step === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // 3. Depth-sorted 3-D patch points coloured by response level.
      const projected = prepared.codes.map(project);
      const order = depthOrder(projected);
      const span = Math.max(fit.radius, 1e-6);
      for (const index of order) {
        const p = projected[index]!;
        const band = prepared.bands[index]!;
        const dimmed = highlight !== null && highlight !== band;
        const depthTone = Math.max(0, Math.min(1, 0.5 + p.depth / (2 * span)));
        ctx.fillStyle = colours[band]!;
        ctx.globalAlpha = dimmed ? 0.12 : 0.48 + 0.48 * depthTone;
        const radius = (highlight === band ? 2.4 : 1.75) + 0.45 * depthTone;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    drawRef.current = draw;
    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(box);
    return () => resizeObserver.disconnect();
  }, [fit, prepared, highlight, height, cloud, initialYawOffset]);

  // Cancel any pending coalesced pointer/keyboard redraw on unmount.
  useEffect(() => () => {
    if (dragRafRef.current !== 0) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
    }
  }, []);

  // Track viewport visibility so off-screen clouds never consume animation frames.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new IntersectionObserver((entries) => {
      setInViewport(entries.some((entry) => entry.isIntersecting));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Join the single shared requestAnimationFrame ticker only while visible, active, and motion-enabled.
  useEffect(() => {
    if (!active || !inViewport || reducedMotion) return;
    return subscribeSharedTicker((dt) => {
      if (dragRef.current?.orbiting) return;
      orbitRef.current = { ...orbitRef.current, yaw: orbitRef.current.yaw + AUTO_YAW_RAD_PER_SEC * dt };
      drawRef.current();
    });
  }, [active, inViewport, reducedMotion]);

  const scheduleInteractionDraw = () => {
    if (dragRafRef.current !== 0) return;
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = 0;
      drawRef.current();
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const box = boxRef.current;
    if (!box) return;
    const p = pagePointer(event, box);
    draggedRef.current = false;
    dragRef.current = { pointerId: event.pointerId, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, orbiting: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = boxRef.current;
    const currentDrag = dragRef.current;
    if (!box || !currentDrag || currentDrag.pointerId !== event.pointerId) return;
    const p = pagePointer(event, box);
    if (!currentDrag.orbiting) {
      if (Math.hypot(p.x - currentDrag.startX, p.y - currentDrag.startY) < CLICK_TOLERANCE_PX) return;
      currentDrag.orbiting = true;
      draggedRef.current = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      orbitRef.current = orbitBy(orbitRef.current, p.x - currentDrag.startX, p.y - currentDrag.startY);
    } else {
      orbitRef.current = orbitBy(orbitRef.current, p.x - currentDrag.lastX, p.y - currentDrag.lastY);
    }
    currentDrag.lastX = p.x;
    currentDrag.lastY = p.y;
    scheduleInteractionDraw();
  };

  const endDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    const currentDrag = dragRef.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    if (currentDrag.orbiting && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (currentDrag.orbiting) setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!ariaLabel) return;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -KEY_ORBIT_STEP_PX;
    else if (event.key === "ArrowRight") dx = KEY_ORBIT_STEP_PX;
    else if (event.key === "ArrowUp") dy = -KEY_ORBIT_STEP_PX;
    else if (event.key === "ArrowDown") dy = KEY_ORBIT_STEP_PX;
    else return;
    event.preventDefault();
    orbitRef.current = orbitBy(orbitRef.current, dx, dy);
    scheduleInteractionDraw();
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!draggedRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    draggedRef.current = false;
  };

  const explicitHeight = height !== undefined;
  return (
    <div
      ref={boxRef}
      className="rotating-cloud-3d"
      data-dragging={dragging || undefined}
      onClickCapture={onClickCapture}
      onDragStart={(event) => event.preventDefault()}
      style={{
        display: "block",
        width: "100%",
        height: explicitHeight ? `${height}px` : "100%",
      }}
    >
      <canvas
        ref={canvasRef}
        role={ariaLabel ? "img" : undefined}
        tabIndex={ariaLabel ? 0 : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={onKeyDown}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "pan-y",
        }}
      />
    </div>
  );
}
