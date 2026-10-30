import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFigureMaterial } from "../materials/material-file";
import { MaterialExports } from "./material-exports";
import { shadertoySections, shadertoyShaderName, shadertoyShaderSource, supportsShadertoy } from "./shadertoy-export";

const folder = new URL("../../../gallery/seed/materials/", import.meta.url);
const readMaterial = (name: string) => readFigureMaterial(JSON.parse(readFileSync(new URL(`${name}.material.json`, folder), "utf8")));
const materials = [
  readMaterial("block-12002-figure-strongest-mean-seed-1"),
  readMaterial("block-2632-figure-seeded-strongest-seed-0"),
  readMaterial("block-4009-figure-2px-strongest-seed-0"),
];
const pyramid = readMaterial("block-4009-figure-pyramid-strongest-seed-0");

describe("Shadertoy export", () => {
  it("round-trips every float32 weight in the three supported material kinds", () => {
    for (const { file, values } of materials) {
      const { common } = shadertoySections(file, values);
      const literals = [...common.matchAll(/const float (?:W1|B1|W2)\[\d+\] = float\[\d+\]\(([^)]*)\);/g)]
        .flatMap((match) => match[1].split(",").map(Number));
      expect(Float32Array.from(literals)).toEqual(values);
    }
  });

  it("exports six pasteable sections with the saved grid, seed and playback settings", () => {
    for (const { file, values } of materials) {
      const source = shadertoyShaderSource(file, values);
      expect(source.match(/\/\/ ===== .* =====/g)).toEqual([
        "// ===== Common =====", "// ===== Buffer A =====", "// ===== Buffer B =====",
        "// ===== Buffer C =====", "// ===== Buffer D =====", "// ===== Image =====",
      ]);
      expect(source).toContain(`const int GRID_SIDE = ${file.reading.side};`);
      expect(source).toContain(`const uint SEED = ${file.reading.seed}u;`);
      expect(source).toContain(`const int PICTURE_PIXELS = ${file.picture?.pixelsPerCell ?? 1};`);
      expect(source).toContain(`const float START_DISC = ${(file.start?.kind === "centre-disc" ? file.start.radius : 0).toPrecision(9)};`);
      expect(source).toContain("Self-feedback is required.");
      expect(source).not.toContain("#version");
      expect(shadertoyShaderName(file)).toBe(`${file.id}.shadertoy.glsl`);
    }
  });

  it("rejects unsupported layouts and invalid weight data at the export boundary", () => {
    expect(supportsShadertoy(pyramid.file)).toBe(false);
    expect(() => shadertoyShaderSource(pyramid.file, pyramid.values)).toThrow("coarse + fine");
    const { file, values } = materials[0];
    expect(() => shadertoyShaderSource(file, values.subarray(1))).toThrow("7,776 finite weights");
    const invalid = values.slice();
    invalid[0] = NaN;
    expect(() => shadertoyShaderSource(file, invalid)).toThrow("7,776 finite weights");
  });

  it("offers the supported export and states why the pyramid download is disabled", () => {
    const markup = (material: typeof pyramid) => renderToStaticMarkup(createElement(MaterialExports, {
      material, onError: () => {},
    }));
    expect(markup(materials[0])).toContain(">Download Shadertoy shader</button>");
    expect(markup(materials[0])).not.toContain("disabled");
    expect(markup(pyramid)).toContain('disabled="">Shadertoy export is not yet available for coarse + fine automata.</button>');
  });
});
