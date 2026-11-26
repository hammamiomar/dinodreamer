// The ground: a site-wide 3-D curved latent manifold behind every page.
//
// Each visual concept (basis group 0..16383, or null for the neutral manifold) maps
// deterministically to a smooth curved surface: principal curvatures, twist, coordinate-net tilt,
// and a local Gaussian well or lobe. Scrolling glides the 64 px coordinate net across the surface
// and gently couples to camera pitch. Perspective foreshortening compresses coordinate lines along
// steep curvature and opens them across recessed basins even at scrollY = 0.
//
// Optical depth shading keeps foreground typography legible: prose corridors attenuate smoothly
// toward black across a 96 px feather, segments are grouped into fixed alpha buckets for batched
// canvas strokes, and the highest primary ridges catch a whisper of the active automaton's
// --sampled colour. One fixed 2-D canvas redraws only on input or during a 520 ms concept morph,
// with zero idle animation frames.

import { pageScale } from "../ui/page-scale";
import { siteManifoldFocus } from "./manifold-focus";

/** The site module: four 16 px patches. Coordinate families share this spatial scale. */
export const MODULE_PX = 64;
/** Morph duration when transitioning between two visual concepts' manifold geometries. */
export const MORPH_MS = 520;
/** Distance outside a prose corridor over which line visibility feathers smoothly back to full. */
export const CORRIDOR_FEATHER_PX = 96;
/** Floor stroke alpha inside reading corridors so body text sits on quiet black. */
export const CORRIDOR_MIN_ALPHA = 0.012;
/** Surface-space scroll translation per pixel of page scroll. */
export const SCROLL_PARALLAX = 0.65;
/** Resting 3-D camera pitch in radians, providing perspective curvature even at scrollY = 0. */
export const BASE_PITCH_RAD = 0.26;
/** Additional camera pitch coupled to page scroll progress on scrollable pages. */
export const SCROLL_PITCH_DELTA_RAD = 0.18;
/** Perspective foreshortening coefficient in 1 / (1 + depth * PERSPECTIVE_STRENGTH). */
export const PERSPECTIVE_STRENGTH = 0.38;
/** Subtle stroke opacity for the --sampled colour pass on elevated primary ridges. */
export const RIDGE_ACCENT_ALPHA = 0.14;

/** Perpendicular distance between adjacent lines of one family (64 / √2). */
const LINE_SPACING_PX = MODULE_PX / Math.SQRT2;
/** Approximate surface-space arc spacing between polyline vertices. */
const SAMPLE_PX = 24;
/** Every fourth line of each family is a primary line eligible for ridge light. */
const BRIGHT_EVERY = 4;

/** Bounds for per-concept dimensionless manifold parameters. */
const MAX_PRINCIPAL_CURVATURE = 0.55;
const MIN_CURVATURE_L1 = 0.34;
const MAX_TWIST = 0.42;
const MAX_ANGLE_RAD = 0.38;
const MAX_WELL_COORD = 0.45;
const MIN_WELL_AMPLITUDE = 0.14;
const MAX_WELL_AMPLITUDE = 0.38;

/** Gaussian lobe and fine-pointer metric indentation shapes in normalized viewport units. */
const INV_TWO_WELL_SIGMA_SQ = 1 / (2 * 0.085);
const POINTER_DIP_AMPLITUDE = -0.11;
const INV_TWO_POINTER_SIGMA_SQ = 1 / (2 * 0.022);
const MIN_PERSPECTIVE_DENOM = 0.35;

/** Fixed alpha buckets for batched strokes: 4 faint buckets and 3 bright primary buckets. */
const FAINT_BUCKET_ALPHAS = [0.012, 0.024, 0.042, 0.062] as const;
const BRIGHT_BUCKET_ALPHAS = [0.036, 0.074, 0.12] as const;
const FAINT_BUCKET_STYLES = FAINT_BUCKET_ALPHAS.map((alpha) => `rgb(255 255 255 / ${alpha})`);
const BRIGHT_BUCKET_STYLES = BRIGHT_BUCKET_ALPHAS.map((alpha) => `rgb(255 255 255 / ${alpha})`);
const TOTAL_BUCKETS = FAINT_BUCKET_ALPHAS.length + BRIGHT_BUCKET_ALPHAS.length;
const TOP_BRIGHT_BUCKET_INDEX = TOTAL_BUCKETS - 1;

/** Primary prose and control columns whose background lines are attenuated for legibility. */
const CORRIDOR_SELECTOR = ".home-words, .how-card, .grow-column, .grow-side, .atlas-control-row, .page-message";

/** Dimensionless surface parameters defining one visual concept's curved manifold. */
export interface ManifoldSignature {
  /** Principal curvature along the horizontal normalized axis, in [-0.55, 0.55]. */
  readonly kappaU: number;
  /** Principal curvature along the vertical normalized axis, in [-0.55, 0.55]. */
  readonly kappaV: number;
  /** Cross-curvature twist term (twist * a * b), in [-0.42, 0.42]. */
  readonly twist: number;
  /** In-plane rotation of the coordinate net away from 45°, in [-0.38, 0.38] radians. */
  readonly angleRad: number;
  /** Normalized horizontal centre of the local Gaussian feature, in [-0.45, 0.45]. */
  readonly wellX: number;
  /** Normalized vertical centre of the local Gaussian feature, in [-0.45, 0.45]. */
  readonly wellY: number;
  /** Signed height of the Gaussian lobe or well, in [-0.45, 0.45]. */
  readonly wellAmplitude: number;
}

/** Graceful default hyperbolic-bowl manifold shown when no specific basis group is active. */
const DEFAULT_SIGNATURE: ManifoldSignature = {
  kappaU: 0.36,
  kappaV: -0.24,
  twist: 0.14,
  angleRad: 0.08,
  wellX: 0.18,
  wellY: -0.12,
  wellAmplitude: -0.22,
};

/** Axis-aligned reading corridor rectangle in viewport page pixels. */
export interface CorridorBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Pointer position in viewport page pixels. */
export interface ManifoldPointer {
  readonly x: number;
  readonly y: number;
}

/** Pure inputs that determine one rendered manifold frame. */
export interface ManifoldView {
  readonly width: number;
  readonly height: number;
  readonly scrollY: number;
  /** Surface-space scroll factor; defaults to SCROLL_PARALLAX (0.65), or 1 under reduced motion. */
  readonly scrollParallax?: number;
  /** Normalized scroll progress in [0, 1] used to couple surface pitch; 0 when static. */
  readonly scrollProgress: number;
  readonly signature: ManifoldSignature;
  /** Active fine-pointer coordinates in viewport page pixels, or null when inactive. */
  readonly pointer: ManifoldPointer | null;
  /** Active --sampled CSS colour for subtle ridge light, or null when neutral. */
  readonly accent: string | null;
  /** Reading corridors in current viewport page pixels. */
  readonly corridors: readonly CorridorBox[];
}

/** One surface point after 3-D height evaluation, camera pitch, and perspective projection. */
export interface ProjectedManifoldPoint {
  readonly x: number;
  readonly y: number;
  /** Surface height z(a, b) before camera pitch (positive = elevated ridge, negative = basin). */
  readonly elevation: number;
  /** Camera-relative depth after pitch (positive = further away, negative = closer). */
  readonly depth: number;
  /** Surface gradient magnitude ||∇z(a, b)|| in normalized coordinates. */
  readonly slope: number;
  /** Perspective scale factor 1 / (1 + depth * PERSPECTIVE_STRENGTH). */
  readonly perspective: number;
}

/**
 * One projected coordinate curve on the manifold.
 * Shape axis P is the number of sampled vertices along the curve.
 */
export interface LatticeLine {
  readonly bright: boolean;
  /** Projected viewport coordinates [x0, y0, x1, y1, ...] with shape (P, 2). */
  readonly points_P2: Float64Array;
  /** Camera-relative depth at each vertex with shape (P,). */
  readonly depths_P: Float64Array;
  /** Surface elevation z(a, b) at each vertex with shape (P,). */
  readonly elevations_P: Float64Array;
  /** Surface slope magnitude ||∇z(a, b)|| at each vertex with shape (P,). */
  readonly slopes_P: Float64Array;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Fast deterministic 32-bit PCG output permutation (PCG-RXS-M-XS-32). */
function pcgHash32(input: number): number {
  const state = (Math.imul(input >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** Independent deterministic uniform float in [0, 1) for a concept group and stream index. */
function hashUnit(group: number, stream: number): number {
  const mixed = (pcgHash32((group + 1) >>> 0) ^ pcgHash32((stream + 0x243f6a88) >>> 0)) >>> 0;
  return pcgHash32(mixed) / 4294967296;
}

function signedRange(unit: number, magnitude: number): number {
  return (unit * 2 - 1) * magnitude;
}

/** Scroll progress p = scrollY / (scrollHeight − viewportHeight), clamped to [0, 1]. */
export function scrollProgress(scrollY: number, scrollHeight: number, viewportHeight: number): number {
  const travel = scrollHeight - viewportHeight;
  if (travel <= 0) return 0;
  return clamp(scrollY / travel, 0, 1);
}

/**
 * Deterministic 3-D manifold signature for basis group `group` (`0..16383`), or a graceful
 * default hyperbolic-bowl manifold when `group` is `null`.
 */
export function manifoldSignature(group: number | null): ManifoldSignature {
  if (group === null || !Number.isFinite(group)) return DEFAULT_SIGNATURE;
  const normalizedGroup = Math.floor(group) >>> 0;

  let kappaU = signedRange(hashUnit(normalizedGroup, 0), MAX_PRINCIPAL_CURVATURE);
  let kappaV = signedRange(hashUnit(normalizedGroup, 1), MAX_PRINCIPAL_CURVATURE);
  const curvatureL1 = Math.abs(kappaU) + Math.abs(kappaV);
  if (curvatureL1 < MIN_CURVATURE_L1) {
    if (curvatureL1 < 1e-6) {
      kappaU = MIN_CURVATURE_L1;
      kappaV = 0;
    } else {
      // Preserves principal curvature ratio and sign (dome, basin, saddle, ridge, trough)
      // while keeping each component well within [-MAX_PRINCIPAL_CURVATURE, MAX_PRINCIPAL_CURVATURE].
      const boost = (MIN_CURVATURE_L1 + 1e-4) / curvatureL1;
      kappaU *= boost;
      kappaV *= boost;
    }
  }

  const twist = signedRange(hashUnit(normalizedGroup, 2), MAX_TWIST);
  const angleRad = signedRange(hashUnit(normalizedGroup, 3), MAX_ANGLE_RAD);
  const wellX = signedRange(hashUnit(normalizedGroup, 4), MAX_WELL_COORD);
  const wellY = signedRange(hashUnit(normalizedGroup, 5), MAX_WELL_COORD);
  const wellSign = hashUnit(normalizedGroup, 6) < 0.5 ? -1 : 1;
  const wellAmplitude = wellSign * (MIN_WELL_AMPLITUDE + hashUnit(normalizedGroup, 7) * (MAX_WELL_AMPLITUDE - MIN_WELL_AMPLITUDE));

  return { kappaU, kappaV, twist, angleRad, wellX, wellY, wellAmplitude };
}

/** Ease-out cubic: 1 - (1 - t)^3, clamped to [0, 1]. */
export function easeOutCubic(progress: number): number {
  const remaining = 1 - clamp(progress, 0, 1);
  return 1 - remaining * remaining * remaining;
}

/** Smoothly interpolate between two manifold signatures using ease-out cubic over `t ∈ [0, 1]`. */
export function interpolateSignature(from: ManifoldSignature, to: ManifoldSignature, t: number): ManifoldSignature {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const eased = easeOutCubic(t);
  return {
    kappaU: from.kappaU + (to.kappaU - from.kappaU) * eased,
    kappaV: from.kappaV + (to.kappaV - from.kappaV) * eased,
    twist: from.twist + (to.twist - from.twist) * eased,
    angleRad: from.angleRad + (to.angleRad - from.angleRad) * eased,
    wellX: from.wellX + (to.wellX - from.wellX) * eased,
    wellY: from.wellY + (to.wellY - from.wellY) * eased,
    wellAmplitude: from.wellAmplitude + (to.wellAmplitude - from.wellAmplitude) * eased,
  };
}

/**
 * Embed surface point `(x, y)` (in viewport page pixels) onto the curved 3-D manifold, pitch by
 * the camera angle, and project with perspective foreshortening.
 */
export function projectManifoldPoint(
  x: number,
  y: number,
  view: Pick<ManifoldView, "width" | "height" | "scrollProgress" | "signature" | "pointer">,
): ProjectedManifoldPoint {
  const radius = Math.max(view.width, view.height, 1);
  const centreX = view.width / 2;
  const centreY = view.height / 2;
  const a = (x - centreX) / radius;
  const b = (y - centreY) / radius;
  const { kappaU, kappaV, twist, wellX, wellY, wellAmplitude } = view.signature;

  // Quadratic principal curvature and cross-twist height field with analytical gradient.
  let elevation = kappaU * a * a + kappaV * b * b + twist * a * b;
  let dzDa = 2 * kappaU * a + twist * b;
  let dzDb = 2 * kappaV * b + twist * a;

  // Local Gaussian lobe or well distinguishing each visual concept.
  const dxWell = a - wellX;
  const dyWell = b - wellY;
  const wellHeight = wellAmplitude * Math.exp(-(dxWell * dxWell + dyWell * dyWell) * INV_TWO_WELL_SIGMA_SQ);
  elevation += wellHeight;
  dzDa += wellHeight * (-2 * dxWell * INV_TWO_WELL_SIGMA_SQ);
  dzDb += wellHeight * (-2 * dyWell * INV_TWO_WELL_SIGMA_SQ);

  // Subtle metric indentation beneath an active fine pointer.
  if (view.pointer !== null) {
    const pointerA = (view.pointer.x - centreX) / radius;
    const pointerB = (view.pointer.y - centreY) / radius;
    const dxPointer = a - pointerA;
    const dyPointer = b - pointerB;
    const dipHeight = POINTER_DIP_AMPLITUDE * Math.exp(-(dxPointer * dxPointer + dyPointer * dyPointer) * INV_TWO_POINTER_SIGMA_SQ);
    elevation += dipHeight;
    dzDa += dipHeight * (-2 * dxPointer * INV_TWO_POINTER_SIGMA_SQ);
    dzDb += dipHeight * (-2 * dyPointer * INV_TWO_POINTER_SIGMA_SQ);
  }

  const pitch = BASE_PITCH_RAD + SCROLL_PITCH_DELTA_RAD * clamp(view.scrollProgress, 0, 1);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  // Pitch around the horizontal axis: top recedes into depth, bottom advances, elevated ridges rise.
  const rotatedY = b * cosPitch - elevation * sinPitch;
  const depth = -(b * sinPitch + elevation * cosPitch);
  const perspective = 1 / Math.max(MIN_PERSPECTIVE_DENOM, 1 + depth * PERSPECTIVE_STRENGTH);

  return {
    x: centreX + a * perspective * radius,
    y: centreY + rotatedY * perspective * radius,
    elevation,
    depth,
    slope: Math.hypot(dzDa, dzDb),
    perspective,
  };
}

/**
 * Smooth visibility factor in [0, 1] for a viewport point `(x, y)` relative to reading corridors.
 * Returns 0 inside any corridor box and smoothsteps to 1 over `featherPx` outside the nearest edge.
 */
export function corridorVisibility(
  x: number,
  y: number,
  corridors: readonly CorridorBox[],
  featherPx = CORRIDOR_FEATHER_PX,
): number {
  if (corridors.length === 0) return 1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < corridors.length; index++) {
    const box = corridors[index]!;
    const dx = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
    const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
    if (dx === 0 && dy === 0) return 0;
    const distance = Math.hypot(dx, dy);
    if (distance < nearestDistance) nearestDistance = distance;
  }
  if (featherPx <= 0) return 1;
  const fraction = Math.min(1, nearestDistance / featherPx);
  return fraction * fraction * (3 - 2 * fraction);
}

/** Attenuate a stroke alpha toward `CORRIDOR_MIN_ALPHA` according to corridor visibility in [0, 1]. */
export function corridorAttenuatedAlpha(rawAlpha: number, visibility: number): number {
  if (rawAlpha <= CORRIDOR_MIN_ALPHA) return rawAlpha;
  return CORRIDOR_MIN_ALPHA + (rawAlpha - CORRIDOR_MIN_ALPHA) * clamp(visibility, 0, 1);
}

/** True when `accent` is a concrete CSS colour the 2-D canvas can stroke directly (not `var(...)`). */
export function isRenderableAccent(accent: string | null): accent is string {
  if (!accent) return false;
  const trimmed = accent.trim();
  return trimmed.startsWith("oklch(") || trimmed.startsWith("rgb(") || trimmed.startsWith("#");
}

/** Clip the line `origin + t * dir` against the centred box `[-halfW, halfW] × [-halfH, halfH]`. */
function clipLineToBox(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  halfW: number,
  halfH: number,
): [number, number] | null {
  let tMin = Number.NEGATIVE_INFINITY;
  let tMax = Number.POSITIVE_INFINITY;

  if (Math.abs(dirX) < 1e-12) {
    if (originX < -halfW || originX > halfW) return null;
  } else {
    const a = (-halfW - originX) / dirX;
    const b = (halfW - originX) / dirX;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
  }

  if (Math.abs(dirY) < 1e-12) {
    if (originY < -halfH || originY > halfH) return null;
  } else {
    const a = (-halfH - originY) / dirY;
    const b = (halfH - originY) / dirY;
    tMin = Math.max(tMin, Math.min(a, b));
    tMax = Math.min(tMax, Math.max(a, b));
  }

  return tMax > tMin ? [tMin, tMax] : null;
}

/**
 * Sample and project both orthogonal coordinate families covering the viewport.
 * Families are spaced by `MODULE_PX / √2`, tilted by `signature.angleRad`, and translated across
 * the curved surface by `scrollOffset = view.scrollY * SCROLL_PARALLAX`.
 */
export function latticeLines(view: ManifoldView): LatticeLine[] {
  if (view.width <= 0 || view.height <= 0) return [];
  const radius = Math.max(view.width, view.height, 1);
  const centreX = view.width / 2;
  const centreY = view.height / 2;
  const scrollOffset = view.scrollY * (view.scrollParallax ?? SCROLL_PARALLAX);
  const theta = Math.PI / 4 + view.signature.angleRad;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  // Overscan box large enough that perspective compression and curvature never expose bare edges.
  const coverHalfW = view.width * 0.95 + 2 * MODULE_PX;
  const coverHalfH = Math.max(view.height * 1.15, radius * 0.8) + 2 * MODULE_PX;

  const corners: readonly [number, number][] = [
    [-coverHalfW, -coverHalfH + scrollOffset],
    [coverHalfW, -coverHalfH + scrollOffset],
    [-coverHalfW, coverHalfH + scrollOffset],
    [coverHalfW, coverHalfH + scrollOffset],
  ];

  const lines: LatticeLine[] = [];

  // Two orthogonal families: constant u (varying v) and constant v (varying u).
  for (const family of [0, 1] as const) {
    let minCoord = Number.POSITIVE_INFINITY;
    let maxCoord = Number.NEGATIVE_INFINITY;
    for (const [cx, cy] of corners) {
      const coord = family === 0 ? cx * cosTheta + cy * sinTheta : -cx * sinTheta + cy * cosTheta;
      if (coord < minCoord) minCoord = coord;
      if (coord > maxCoord) maxCoord = coord;
    }
    const first = Math.floor(minCoord / LINE_SPACING_PX);
    const last = Math.ceil(maxCoord / LINE_SPACING_PX);

    for (let index = first; index <= last; index++) {
      const fixedCoord = index * LINE_SPACING_PX;
      const originX = family === 0 ? fixedCoord * cosTheta : -fixedCoord * sinTheta;
      const originY = (family === 0 ? fixedCoord * sinTheta : fixedCoord * cosTheta) - scrollOffset;
      const dirX = family === 0 ? -sinTheta : cosTheta;
      const dirY = family === 0 ? cosTheta : sinTheta;

      const clipped = clipLineToBox(originX, originY, dirX, dirY, coverHalfW, coverHalfH);
      if (clipped === null) continue;
      const [from, to] = clipped;
      const segmentCount = Math.max(1, Math.ceil((to - from) / SAMPLE_PX));
      const pointCount = segmentCount + 1;

      const points_P2 = new Float64Array(2 * pointCount);
      const depths_P = new Float64Array(pointCount);
      const elevations_P = new Float64Array(pointCount);
      const slopes_P = new Float64Array(pointCount);

      for (let sample = 0; sample < pointCount; sample++) {
        const param = from + ((to - from) * sample) / segmentCount;
        const x = centreX + originX + param * dirX;
        const y = centreY + originY + param * dirY;
        const projected = projectManifoldPoint(x, y, view);
        points_P2[2 * sample] = projected.x;
        points_P2[2 * sample + 1] = projected.y;
        depths_P[sample] = projected.depth;
        elevations_P[sample] = projected.elevation;
        slopes_P[sample] = projected.slope;
      }

      const bright = ((index % BRIGHT_EVERY) + BRIGHT_EVERY) % BRIGHT_EVERY === 0;
      lines.push({ bright, points_P2, depths_P, elevations_P, slopes_P });
    }
  }

  return lines;
}

/** Map a segment's projected depth, elevation, slope, and corridor visibility to a bucket index. */
function segmentBucket(
  bright: boolean,
  depth: number,
  elevation: number,
  slope: number,
  visibility: number,
): number {
  const depthFactor = clamp(0.55 - depth * 0.85 + elevation * 0.35, 0, 1);
  const slopeFactor = clamp(slope / 0.85, 0, 1);
  const prominence = clamp(0.65 * depthFactor + 0.35 * slopeFactor, 0, 1);

  const rawAlpha = bright ? 0.028 + prominence * (0.12 - 0.028) : 0.014 + prominence * (0.062 - 0.014);
  const alpha = corridorAttenuatedAlpha(rawAlpha, visibility);

  // Heavily corridor-attenuated primary lines share the quietest faint bucket so text stays clean.
  if (alpha <= 0.018) return 0;

  if (!bright) {
    if (alpha < 0.033) return 1;
    if (alpha < 0.052) return 2;
    return 3;
  }

  if (alpha < 0.055) return FAINT_BUCKET_ALPHAS.length;
  if (alpha < 0.092) return FAINT_BUCKET_ALPHAS.length + 1;
  return TOP_BRIGHT_BUCKET_INDEX;
}

/** Stroke a flat [x0, y0, x1, y1, ...] segment list, coalescing connected sub-paths. */
function traceSegments(context: CanvasRenderingContext2D, segments: readonly number[]): void {
  let prevX = Number.NaN;
  let prevY = Number.NaN;
  for (let index = 0; index < segments.length; index += 4) {
    const x0 = segments[index]!;
    const y0 = segments[index + 1]!;
    const x1 = segments[index + 2]!;
    const y1 = segments[index + 3]!;
    if (x0 !== prevX || y0 !== prevY) context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    prevX = x1;
    prevY = y1;
  }
}

/** Draw the projected 3-D manifold in batched alpha buckets plus optional --sampled ridge light. */
export function drawLattice(context: CanvasRenderingContext2D, view: ManifoldView): void {
  context.clearRect(0, 0, view.width, view.height);
  if (view.width <= 0 || view.height <= 0) return;

  const lines = latticeLines(view);
  const buckets: number[][] = Array.from({ length: TOTAL_BUCKETS }, () => []);
  const cullPad = 16;

  for (const line of lines) {
    const { bright, points_P2, depths_P, elevations_P, slopes_P } = line;
    for (let vertex = 0; vertex + 1 < depths_P.length; vertex++) {
      const x0 = points_P2[2 * vertex]!;
      const y0 = points_P2[2 * vertex + 1]!;
      const x1 = points_P2[2 * (vertex + 1)]!;
      const y1 = points_P2[2 * (vertex + 1) + 1]!;

      if (
        (x0 < -cullPad && x1 < -cullPad) ||
        (x0 > view.width + cullPad && x1 > view.width + cullPad) ||
        (y0 < -cullPad && y1 < -cullPad) ||
        (y0 > view.height + cullPad && y1 > view.height + cullPad)
      ) {
        continue;
      }

      const midX = 0.5 * (x0 + x1);
      const midY = 0.5 * (y0 + y1);
      const visibility = corridorVisibility(midX, midY, view.corridors);
      const bucketIndex = segmentBucket(
        bright,
        0.5 * (depths_P[vertex]! + depths_P[vertex + 1]!),
        0.5 * (elevations_P[vertex]! + elevations_P[vertex + 1]!),
        0.5 * (slopes_P[vertex]! + slopes_P[vertex + 1]!),
        visibility,
      );
      buckets[bucketIndex]!.push(x0, y0, x1, y1);
    }
  }

  context.lineWidth = 1;
  for (let index = 0; index < TOTAL_BUCKETS; index++) {
    const segments = buckets[index]!;
    if (segments.length === 0) continue;
    context.beginPath();
    traceSegments(context, segments);
    context.strokeStyle =
      index < FAINT_BUCKET_ALPHAS.length
        ? FAINT_BUCKET_STYLES[index]!
        : BRIGHT_BUCKET_STYLES[index - FAINT_BUCKET_ALPHAS.length]!;
    context.stroke();
  }

  const ridgeSegments = buckets[TOP_BRIGHT_BUCKET_INDEX]!;
  if (ridgeSegments.length > 0 && isRenderableAccent(view.accent)) {
    context.save();
    context.globalAlpha = RIDGE_ACCENT_ALPHA;
    context.strokeStyle = view.accent;
    context.beginPath();
    traceSegments(context, ridgeSegments);
    context.stroke();
    context.restore();
  }
}

interface CachedCorridor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly fixed: boolean;
}

/** Query primary reading-corridor bounding boxes once on resize, route change, or focus change. */
function measureCorridors(scale: number, scrollY: number): CachedCorridor[] {
  const elements = document.querySelectorAll(CORRIDOR_SELECTOR);
  const measured: CachedCorridor[] = [];
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const fixed = window.getComputedStyle(element).position === "fixed";
    const offsetY = fixed ? 0 : scrollY;
    measured.push({
      left: rect.left / scale,
      top: rect.top / scale + offsetY,
      right: rect.right / scale,
      bottom: rect.bottom / scale + offsetY,
      fixed,
    });
  }
  return measured;
}

function resolveViewportCorridors(cached: readonly CachedCorridor[], scrollY: number): CorridorBox[] {
  if (cached.length === 0) return [];
  const boxes: CorridorBox[] = new Array(cached.length);
  for (let index = 0; index < cached.length; index++) {
    const item = cached[index]!;
    const offsetY = item.fixed ? 0 : scrollY;
    boxes[index] = {
      left: item.left,
      top: item.top - offsetY,
      right: item.right,
      bottom: item.bottom - offsetY,
    };
  }
  return boxes;
}

export interface Lattice {
  /** Whether scroll progress gently pitches the manifold (true on frame pages; false on static pages). */
  setBends(bends: boolean): void;
  /** Re-measure reading corridors and redraw after a route or layout change without scroll or resize. */
  redraw(): void;
  stop(): void;
}

/**
 * Mount the site-wide 3-D curved latent manifold ground onto `canvas`.
 * Redraws on scroll, resize, concept focus changes (morphing over 520 ms then stopping), and
 * fine-pointer motion, with zero idle rAF loop. Under `prefers-reduced-motion: reduce`, renders
 * the current concept's 3-D manifold statically.
 */
export function startLattice(canvas: HTMLCanvasElement): Lattice {
  const context = canvas.getContext("2d");
  const finePointer = window.matchMedia("(pointer: fine)");

  let bends = false;
  let width = 0;
  let height = 0;
  let scale = 1;
  let pending = 0;
  let corridorsDirty = true;
  let cachedCorridors: CachedCorridor[] = [];
  let pointer: ManifoldPointer | null = null;

  let focus = siteManifoldFocus.getFocus();
  let displayedSignature = manifoldSignature(focus.group);
  let morphFrom: ManifoldSignature = displayedSignature;
  let morphTo: ManifoldSignature = displayedSignature;
  let morphStartMs: number | null = null;
  let morphPending = false;

  // Device pixels up to 2× CSS pixels; scaled into site page units so the 64 px module aligns
  // with the page grid at any --page-scale (ui/page-scale.ts).
  const size = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    scale = pageScale(document.querySelector(".site"));
    width = canvas.clientWidth / scale;
    height = canvas.clientHeight / scale;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    context?.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
  };

  const draw = (now: number) => {
    pending = 0;
    if (!context) return;
    if (pageScale(document.querySelector(".site")) !== scale) {
      size();
      corridorsDirty = true;
    }

    const root = document.documentElement;
    const scrollY = window.scrollY / scale;
    if (corridorsDirty) {
      cachedCorridors = measureCorridors(scale, scrollY);
      corridorsDirty = false;
    }

    let morphActive = false;
    if (morphPending) {
      morphPending = false;
      morphStartMs = now;
    }
    if (morphStartMs !== null) {
      const progress = clamp((now - morphStartMs) / MORPH_MS, 0, 1);
      displayedSignature = interpolateSignature(morphFrom, morphTo, progress);
      if (progress >= 1) morphStartMs = null;
      else morphActive = true;
    }

    const progress = bends ? scrollProgress(window.scrollY, root.scrollHeight, root.clientHeight) : 0;

    drawLattice(context, {
      width,
      height,
      scrollY,
      scrollParallax: SCROLL_PARALLAX,
      scrollProgress: progress,
      signature: displayedSignature,
      pointer: finePointer.matches ? pointer : null,
      accent: focus.accent,
      corridors: resolveViewportCorridors(cachedCorridors, scrollY),
    });

    if (morphActive) schedule();
  };

  const schedule = () => {
    if (pending === 0) pending = requestAnimationFrame(draw);
  };

  const onResize = () => {
    size();
    corridorsDirty = true;
    schedule();
  };

  const syncFocus = (): boolean => {
    const next = siteManifoldFocus.getFocus();
    const groupChanged = next.group !== focus.group;
    const accentChanged = next.accent !== focus.accent;
    focus = next;
    if (!groupChanged && !accentChanged) return false;
    corridorsDirty = true;
    if (groupChanged) {
      const target = manifoldSignature(next.group);
      morphFrom = displayedSignature;
      morphTo = target;
      morphStartMs = null;
      morphPending = true;
    }
    return true;
  };

  const onFocusChange = () => {
    if (syncFocus()) schedule();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!finePointer.matches) return;
    if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    pointer = { x: event.clientX / scale, y: event.clientY / scale };
    schedule();
  };

  const onPointerClear = () => {
    if (pointer === null) return;
    pointer = null;
    schedule();
  };

  const onMediaChange = () => {
    if (!finePointer.matches) {
      pointer = null;
    }
    schedule();
  };

  size();
  draw(performance.now());

  const unsubscribeFocus = siteManifoldFocus.subscribe(onFocusChange);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerClear);
  window.addEventListener("blur", onPointerClear);
  finePointer.addEventListener("change", onMediaChange);

  return {
    setBends(next) {
      if (bends === next) return;
      bends = next;
      schedule();
    },
    redraw() {
      syncFocus();
      corridorsDirty = true;
      schedule();
    },
    stop() {
      if (pending !== 0) cancelAnimationFrame(pending);
      unsubscribeFocus();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerClear);
      window.removeEventListener("blur", onPointerClear);
      finePointer.removeEventListener("change", onMediaChange);
    },
  };
}
