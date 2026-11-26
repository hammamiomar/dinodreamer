import { describe, expect, test } from "vitest";
import {
  CORRIDOR_FEATHER_PX,
  CORRIDOR_MIN_ALPHA,
  corridorAttenuatedAlpha,
  corridorVisibility,
  drawLattice,
  interpolateSignature,
  isRenderableAccent,
  latticeLines,
  manifoldSignature,
  MODULE_PX,
  MORPH_MS,
  projectManifoldPoint,
  RIDGE_ACCENT_ALPHA,
  scrollProgress,
  type CorridorBox,
  type ManifoldView,
} from "./lattice";

const WINDOW = { width: 1440, height: 900 };

function baseView(overrides: Partial<ManifoldView> = {}): ManifoldView {
  return {
    ...WINDOW,
    scrollY: 0,
    scrollProgress: 0,
    signature: manifoldSignature(null),
    pointer: null,
    accent: null,
    corridors: [],
    ...overrides,
  };
}

describe("scrollProgress", () => {
  test("returns 0 on non-scrolling pages, 1 at the bottom, and clamps to [0, 1]", () => {
    expect(scrollProgress(0, 900, 900)).toBe(0);
    expect(scrollProgress(500, 1900, 900)).toBe(0.5);
    expect(scrollProgress(1000, 1900, 900)).toBe(1);
    expect(scrollProgress(-40, 1900, 900)).toBe(0);
    expect(scrollProgress(1200, 1900, 900)).toBe(1);
  });
});

describe("manifoldSignature", () => {
  const sampleGroups: readonly (number | null)[] = [null, 6638, 13345, 4009];

  test("is deterministic and stays within physical parameter bounds across groups", () => {
    for (const group of [...sampleGroups, 0, 1, 512, 16383]) {
      const first = manifoldSignature(group);
      const second = manifoldSignature(group);
      expect(first).toEqual(second);

      expect(Math.abs(first.kappaU)).toBeLessThanOrEqual(0.55);
      expect(Math.abs(first.kappaV)).toBeLessThanOrEqual(0.55);
      expect(Math.abs(first.kappaU) + Math.abs(first.kappaV)).toBeGreaterThanOrEqual(0.34);
      expect(Math.abs(first.twist)).toBeLessThanOrEqual(0.42);
      expect(Math.abs(first.angleRad)).toBeLessThanOrEqual(0.38);
      expect(Math.abs(first.wellX)).toBeLessThanOrEqual(0.45);
      expect(Math.abs(first.wellY)).toBeLessThanOrEqual(0.45);
      expect(Math.abs(first.wellAmplitude)).toBeLessThanOrEqual(0.45);
    }
  });

  test("produces distinct manifold geometries across representative groups 6638, 13345, 4009, and null", () => {
    const signatures = sampleGroups.map((group) => manifoldSignature(group));
    for (let i = 0; i < signatures.length; i++) {
      for (let j = i + 1; j < signatures.length; j++) {
        const a = signatures[i]!;
        const b = signatures[j]!;
        const delta =
          Math.abs(a.kappaU - b.kappaU) +
          Math.abs(a.kappaV - b.kappaV) +
          Math.abs(a.twist - b.twist) +
          Math.abs(a.angleRad - b.angleRad) +
          Math.abs(a.wellAmplitude - b.wellAmplitude);
        expect(delta).toBeGreaterThan(0.25);
      }
    }
  });
});

describe("interpolateSignature", () => {
  test("matches endpoints exactly and follows ease-out cubic in between", () => {
    expect(MORPH_MS).toBe(520);
    const from = manifoldSignature(6638);
    const to = manifoldSignature(4009);

    expect(interpolateSignature(from, to, 0)).toEqual(from);
    expect(interpolateSignature(from, to, -0.5)).toEqual(from);
    expect(interpolateSignature(from, to, 1)).toEqual(to);
    expect(interpolateSignature(from, to, 1.5)).toEqual(to);

    // At t = 0.5, ease-out cubic is 1 - 0.5^3 = 0.875.
    const mid = interpolateSignature(from, to, 0.5);
    const eased = 1 - 0.5 ** 3;
    expect(mid.kappaU).toBeCloseTo(from.kappaU + (to.kappaU - from.kappaU) * eased, 12);
    expect(mid.kappaV).toBeCloseTo(from.kappaV + (to.kappaV - from.kappaV) * eased, 12);
    expect(mid.twist).toBeCloseTo(from.twist + (to.twist - from.twist) * eased, 12);
    expect(mid.angleRad).toBeCloseTo(from.angleRad + (to.angleRad - from.angleRad) * eased, 12);
    expect(mid.wellX).toBeCloseTo(from.wellX + (to.wellX - from.wellX) * eased, 12);
    expect(mid.wellY).toBeCloseTo(from.wellY + (to.wellY - from.wellY) * eased, 12);
    expect(mid.wellAmplitude).toBeCloseTo(from.wellAmplitude + (to.wellAmplitude - from.wellAmplitude) * eased, 12);

    // Leaving a focused concept (e.g. /train?block=4009 -> /index) morphs cleanly back to the neutral manifold.
    const neutral = manifoldSignature(null);
    expect(interpolateSignature(to, neutral, 1)).toEqual(neutral);
  });
});

describe("3-D manifold projection and curvature at scrollY = 0", () => {
  test("exhibits clear non-flat 3-D curvature and perspective variation even at scrollY = 0 with group = null", () => {
    const view = baseView({ scrollY: 0, scrollProgress: 0, signature: manifoldSignature(null) });
    const left = projectManifoldPoint(120, 450, view);
    const middle = projectManifoldPoint(720, 450, view);
    const right = projectManifoldPoint(1320, 450, view);

    // Three collinear horizontal samples must curve vertically after 3-D projection.
    const chordMidY = 0.5 * (left.y + right.y);
    expect(Math.abs(middle.y - chordMidY)).toBeGreaterThan(6);

    // Perspective scale varies between top receding edge and bottom foreground edge.
    const top = projectManifoldPoint(720, 40, view);
    const bottom = projectManifoldPoint(720, 860, view);
    expect(bottom.perspective).toBeGreaterThan(top.perspective);
  });

  test("scroll progress pitches the surface and an active pointer creates a local indentation", () => {
    const restView = baseView({ scrollProgress: 0, signature: manifoldSignature(13345) });
    const pitchedView = baseView({ scrollProgress: 1, signature: manifoldSignature(13345) });
    const restPoint = projectManifoldPoint(720, 120, restView);
    const pitchedPoint = projectManifoldPoint(720, 120, pitchedView);
    expect(pitchedPoint.depth).toBeGreaterThan(restPoint.depth);

    const pointedView = baseView({ signature: manifoldSignature(13345), pointer: { x: 720, y: 450 } });
    const withoutPointer = projectManifoldPoint(720, 450, restView);
    const withPointer = projectManifoldPoint(720, 450, pointedView);
    expect(withPointer.elevation).toBeLessThan(withoutPointer.elevation);
  });

  test("latticeLines covers the entire viewport with both faint and bright curves on the 64 px module scale", () => {
    expect(MODULE_PX).toBe(64);
    const lines = latticeLines(baseView({ signature: manifoldSignature(6638) }));
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.some((line) => line.bright)).toBe(true);
    expect(lines.some((line) => !line.bright)).toBe(true);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const line of lines) {
      expect(line.points_P2.length).toBe(line.depths_P.length * 2);
      expect(line.elevations_P.length).toBe(line.depths_P.length);
      expect(line.slopes_P.length).toBe(line.depths_P.length);
      for (let index = 0; index < line.points_P2.length; index += 2) {
        const x = line.points_P2[index]!;
        const y = line.points_P2[index + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    expect(minX).toBeLessThan(0);
    expect(maxX).toBeGreaterThan(WINDOW.width);
    expect(minY).toBeLessThan(0);
    expect(maxY).toBeGreaterThan(WINDOW.height);
  });
});

describe("reading-corridor attenuation and --sampled ridge light", () => {
  const corridor: CorridorBox = { left: 100, top: 200, right: 548, bottom: 700 };

  test("attenuates smoothly from CORRIDOR_MIN_ALPHA inside a corridor to full alpha past CORRIDOR_FEATHER_PX", () => {
    expect(corridorVisibility(300, 450, [corridor])).toBe(0);
    expect(corridorAttenuatedAlpha(0.11, 0)).toBeCloseTo(CORRIDOR_MIN_ALPHA, 6);

    const halfFeather = corridorVisibility(548 + CORRIDOR_FEATHER_PX / 2, 450, [corridor]);
    expect(halfFeather).toBeCloseTo(0.5, 6);
    expect(corridorAttenuatedAlpha(0.11, halfFeather)).toBeGreaterThan(CORRIDOR_MIN_ALPHA);
    expect(corridorAttenuatedAlpha(0.11, halfFeather)).toBeLessThan(0.11);

    const clear = corridorVisibility(548 + CORRIDOR_FEATHER_PX + 10, 450, [corridor]);
    expect(clear).toBe(1);
    expect(corridorAttenuatedAlpha(0.11, clear)).toBeCloseTo(0.11, 6);
  });

  test("accepts concrete CSS colours for ridge light and rejects CSS variable references", () => {
    expect(isRenderableAccent("oklch(72.0% 0.110 45.0)")).toBe(true);
    expect(isRenderableAccent("rgb(120 180 240)")).toBe(true);
    expect(isRenderableAccent("#ee9a62")).toBe(true);
    expect(isRenderableAccent("var(--ink-2)")).toBe(false);
    expect(isRenderableAccent(null)).toBe(false);
    expect(isRenderableAccent("")).toBe(false);
  });

  test("scrollY translates coordinate lines across the manifold surface and honors scrollParallax: 1 for reduced motion", () => {
    const signature = manifoldSignature(4009);
    const atTop = latticeLines(baseView({ scrollY: 0, signature }));
    const parallaxScrolled = latticeLines(baseView({ scrollY: 320, signature }));
    const lockedScrolled = latticeLines(baseView({ scrollY: 320, scrollParallax: 1, signature }));
    expect(atTop[0]!.points_P2[1]).not.toBeCloseTo(parallaxScrolled[0]!.points_P2[1]!, 1);
    // With scrollParallax = 1 (reduced motion), scrolling by 320 px shifts by the exact same
    // surface offset as default parallax (0.65) scrolled by 320 / 0.65 px.
    const equivalentParallax = latticeLines(baseView({ scrollY: 320 / 0.65, signature }));
    expect(lockedScrolled[0]!.points_P2[0]).toBeCloseTo(equivalentParallax[0]!.points_P2[0]!, 9);
    expect(lockedScrolled[0]!.points_P2[1]).toBeCloseTo(equivalentParallax[0]!.points_P2[1]!, 9);
  });

  test("drawLattice batches strokes by alpha bucket, adds a single ridge-light pass for concrete accents, and quiets prose corridors", () => {
    function recordStrokes(view: ManifoldView) {
      const strokes: { strokeStyle: string; globalAlpha: number }[] = [];
      let strokeStyle = "";
      let globalAlpha = 1;
      const saved: { strokeStyle: string; globalAlpha: number }[] = [];
      const context = {
        lineWidth: 1,
        get strokeStyle() {
          return strokeStyle;
        },
        set strokeStyle(value: string) {
          strokeStyle = value;
        },
        get globalAlpha() {
          return globalAlpha;
        },
        set globalAlpha(value: number) {
          globalAlpha = value;
        },
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        save() {
          saved.push({ strokeStyle, globalAlpha });
        },
        restore() {
          const previous = saved.pop();
          if (previous) {
            strokeStyle = previous.strokeStyle;
            globalAlpha = previous.globalAlpha;
          }
        },
        stroke() {
          strokes.push({ strokeStyle, globalAlpha });
        },
      } as unknown as CanvasRenderingContext2D;
      drawLattice(context, view);
      return strokes;
    }

    const accent = "oklch(72.0% 0.110 45.0)";
    const withAccent = recordStrokes(baseView({ signature: manifoldSignature(6638), accent }));
    const accentPasses = withAccent.filter((entry) => entry.strokeStyle === accent);
    expect(accentPasses).toHaveLength(1);
    expect(accentPasses[0]!.globalAlpha).toBe(RIDGE_ACCENT_ALPHA);
    expect(withAccent.length).toBeLessThanOrEqual(8);

    const withCssVar = recordStrokes(baseView({ signature: manifoldSignature(6638), accent: "var(--ink-2)" }));
    expect(withCssVar.some((entry) => entry.strokeStyle === "var(--ink-2)")).toBe(false);

    // Covering the entire viewport in a reading corridor drops all strokes to the floor bucket and suppresses ridge light.
    const fullCorridor: CorridorBox = { left: -64, top: -64, right: WINDOW.width + 64, bottom: WINDOW.height + 64 };
    const quiet = recordStrokes(baseView({ signature: manifoldSignature(6638), accent, corridors: [fullCorridor] }));
    expect(quiet).toHaveLength(1);
    expect(quiet[0]!.strokeStyle).toBe(`rgb(255 255 255 / ${CORRIDOR_MIN_ALPHA})`);
  });
});
