// The ground: a lattice of two families of 45° lines behind every page.
// The lines are spaced 64 / √2 apart, so their crossings sit on the 64 px module, and
// every fourth line is brighter. The lattice is fixed to the page: it scrolls with the content.
//
// On a reading page the sheet bends as the visitor goes down. The bend is a conformal map of the
// viewport whose only parameter is the scroll progress p, never the scroll speed: a given place
// on the page always looks the same, and nothing moves while the page is still. A conformal map
// keeps angles, so the cells stay square where they bend and the lines stay continuous.
//
// One fixed 2-D canvas, redrawn on scroll and resize only. Nothing here is drawn on a material.

/**
 * The module: four patches of 16 px. Neighbouring lines of one family meet a horizontal line
 * 64 px apart, so they are 64 / √2 apart measured across them, and the crossings sit on it.
 */
import { pageScale } from "../ui/page-scale";

export const MODULE_PX = 64;
/** Each line is a polyline with a vertex about every 24 px of its length, smooth at any bend. */
const SAMPLE_PX = 24;
/** Every fourth line of a family is the brighter one. */
const BRIGHT_EVERY = 4;
const FAINT = "rgb(255 255 255 / 0.045)";
const BRIGHT = "rgb(255 255 255 / 0.085)";

/**
 * k at the end of a reading page (p = 1). The map is w = z + k·e^{iθ}·z². With k = 0.35 the
 * corners of a 1440 × 900 window move about 150 px at the end of the page and the centre not at
 * all. Tuned by eye on /how.
 */
export const BEND_AT_END = 0.35;
/**
 * Turn angle θ of the quadratic term. With θ = −90°, the bend follows scroll: the left and right
 * edges rise while the top and bottom sink, curving away from the reader.
 */
export const BEND_TURN_RAD = -Math.PI / 2;

/** What a drawing depends on: the canvas's size in CSS pixels, the page's scroll, the bend k. */
export interface LatticeView {
  width: number;
  height: number;
  scrollY: number;
  bend: number;
}

/** One line of the lattice, as the points to join, in viewport pixels. */
export interface LatticeLine {
  bright: boolean;
  points_P2: Float64Array;
}

/** p = scrollY / (scrollHeight − innerHeight), in [0, 1]; 0 on a page that does not scroll. */
export function scrollProgress(scrollY: number, scrollHeight: number, viewportHeight: number): number {
  const travel = scrollHeight - viewportHeight;
  if (travel <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / travel));
}

/** The bend k for a scroll progress p: k = BEND_AT_END · p on a reading page, 0 on a flat one. */
export function bendFor(progress: number, bends: boolean): number {
  return bends ? BEND_AT_END * progress : 0;
}

/**
 * The bent place of the viewport point (x, y). With R = max(width, height) and the window's
 * centre (cx, cy), z = ((x − cx) + i(y − cy)) / R and the drawn point is w = z + k·e^{iθ}·z²,
 * scaled back by R. At k = 0 it is the point itself; the centre never moves.
 */
export function bendPoint(x: number, y: number, view: Pick<LatticeView, "width" | "height" | "bend">): [number, number] {
  if (view.bend === 0) return [x, y];
  const radius = Math.max(view.width, view.height);
  const centreX = view.width / 2;
  const centreY = view.height / 2;
  const a = (x - centreX) / radius;
  const b = (y - centreY) / radius;
  // z² = (a² − b²) + i·2ab, turned by θ and scaled by k.
  const squareRe = a * a - b * b;
  const squareIm = 2 * a * b;
  const turnRe = Math.cos(BEND_TURN_RAD);
  const turnIm = Math.sin(BEND_TURN_RAD);
  const bentRe = a + view.bend * (turnRe * squareRe - turnIm * squareIm);
  const bentIm = b + view.bend * (turnRe * squareIm + turnIm * squareRe);
  return [centreX + bentRe * radius, centreY + bentIm * radius];
}

/**
 * Every line that can reach the window, sampled and bent. Family "down" is x − yPage = 64·n and
 * family "up" is x + yPage = 64·n, with yPage = y + scrollY, so a crossing lies on (32·i, 32·j)
 * with i + j even: every module corner (64·i, 64·j) of the page is one. Lines are taken from a
 * margin around the window as wide as the largest bend can move a point, so a bent window has no
 * gap at its edges.
 */
export function latticeLines(view: LatticeView): LatticeLine[] {
  const radius = Math.max(view.width, view.height);
  const margin = MODULE_PX + Math.ceil(view.bend * radius);
  const top = -margin;
  const bottom = view.height + margin;
  const left = -margin;
  const right = view.width + margin;
  // Along a 45° line, x changes by one pixel per pixel of y, so a vertex every SAMPLE_PX of
  // length is one every SAMPLE_PX / √2 of y.
  const stepY = SAMPLE_PX / Math.SQRT2;
  const lines: LatticeLine[] = [];
  for (const slope of [1, -1] as const) {
    // On a line, x = 64·n + slope·(y + scrollY); n covers every line that crosses the margin box.
    const offsets = [left - slope * (top + view.scrollY), left - slope * (bottom + view.scrollY), right - slope * (top + view.scrollY), right - slope * (bottom + view.scrollY)];
    const first = Math.floor(Math.min(...offsets) / MODULE_PX);
    const last = Math.ceil(Math.max(...offsets) / MODULE_PX);
    for (let n = first; n <= last; n++) {
      const offset = n * MODULE_PX;
      // The part of the line inside the margin box: x within [left, right] and y within [top, bottom].
      const yAtLeft = slope * (left - offset) - view.scrollY;
      const yAtRight = slope * (right - offset) - view.scrollY;
      const from = Math.max(top, Math.min(yAtLeft, yAtRight));
      const to = Math.min(bottom, Math.max(yAtLeft, yAtRight));
      if (to <= from) continue;
      const count = Math.max(1, Math.ceil((to - from) / stepY));
      const points_P2 = new Float64Array(2 * (count + 1));
      for (let index = 0; index <= count; index++) {
        const y = from + ((to - from) * index) / count;
        const x = offset + slope * (y + view.scrollY);
        const [bentX, bentY] = bendPoint(x, y, view);
        points_P2[2 * index] = bentX;
        points_P2[2 * index + 1] = bentY;
      }
      lines.push({ bright: ((n % BRIGHT_EVERY) + BRIGHT_EVERY) % BRIGHT_EVERY === 0, points_P2 });
    }
  }
  return lines;
}

/** Draw the lattice: two strokes, the faint lines and then the bright ones. */
function drawLattice(context: CanvasRenderingContext2D, view: LatticeView): void {
  const lines = latticeLines(view);
  context.clearRect(0, 0, view.width, view.height);
  context.lineWidth = 1;
  for (const bright of [false, true]) {
    context.beginPath();
    for (const line of lines) {
      if (line.bright !== bright) continue;
      const points_P2 = line.points_P2;
      context.moveTo(points_P2[0], points_P2[1]);
      for (let index = 2; index < points_P2.length; index += 2) context.lineTo(points_P2[index], points_P2[index + 1]);
    }
    context.strokeStyle = bright ? BRIGHT : FAINT;
    context.stroke();
  }
}

export interface Lattice {
  /** Whether this page bends (frame.tsx: every frame page; the pages outside the frame do not); a flat page draws k = 0 at any scroll. */
  setBends(bends: boolean): void;
  /** Draw again after the page changed under it without a scroll or a resize: a new route, whose page scale may differ. */
  redraw(): void;
  stop(): void;
}

/**
 * Draw the lattice on `canvas` (fixed over the window, under the page) and redraw it on scroll
 * and resize only, once per animation frame at most. With reduced motion it stays flat.
 */
export function startLattice(canvas: HTMLCanvasElement): Lattice {
  const context = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let bends = false;
  let width = 0;
  let height = 0;
  let pending = 0;

  // The canvas holds device pixels, at most two per CSS pixel. It lies outside the site, so it is not
  // zoomed: it draws in the site's page units, the module times the page scale on the screen, so its
  // crossings stay on the page's edges at any scale (ui/page-scale.ts).
  let scale = 1;
  const size = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    scale = pageScale(document.querySelector(".site"));
    width = canvas.clientWidth / scale;
    height = canvas.clientHeight / scale;
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
    context?.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
  };
  const draw = () => {
    pending = 0;
    if (!context) return;
    // The image editor keeps scale 1 and the other pages 1.25 on a wide window: a route change can change it.
    if (pageScale(document.querySelector(".site")) !== scale) size();
    const root = document.documentElement;
    const progress = scrollProgress(window.scrollY, root.scrollHeight, root.clientHeight);
    drawLattice(context, { width, height, scrollY: window.scrollY / scale, bend: bendFor(progress, bends && !reducedMotion.matches) });
  };
  const schedule = () => {
    if (pending === 0) pending = requestAnimationFrame(draw);
  };
  const resize = () => {
    size();
    schedule();
  };

  size();
  draw();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", resize);
  reducedMotion.addEventListener("change", schedule);
  return {
    setBends(next) {
      bends = next;
      schedule();
    },
    redraw() {
      schedule();
    },
    stop() {
      if (pending !== 0) cancelAnimationFrame(pending);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      reducedMotion.removeEventListener("change", schedule);
    },
  };
}
