import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readFigureMaterial } from "../materials/material-file";
import { embeddedRuleShaderName, embeddedRuleShaderSource, wgslFloat } from "./embedded-rule-shader";
import { FIGURE_WGSL } from "./figure-shaders";

const seedFolder = new URL("../../../gallery/seed/materials/", import.meta.url);
// One shipped file per supported layout/start/picture combination. Collection-wide
// qualification belongs to material-files.audit.test.ts and the GPU export audit.
const readSeed = (name: string) => readFigureMaterial(JSON.parse(readFileSync(new URL(name, seedFolder), "utf8")));
const cell = readSeed("block-12002-figure-strongest-mean-seed-1.material.json");
const seededCell = readSeed("block-2632-figure-seeded-strongest-seed-0.material.json");
const coarse = readSeed("block-4009-figure-2px-strongest-seed-0.material.json");
const pyramid = readSeed("block-4009-figure-pyramid-strongest-seed-0.material.json");
const seededPyramid = readSeed("block-11266-stage-6-pyramid-seeded-strongest-seed-0.material.json");
const kinds = [cell, seededCell, coarse, pyramid, seededPyramid];

/** The literals of one constant array, in order. */
function literals(source: string, name: string): number[] {
  const body = source.match(new RegExp(`const ${name} = array<f32, \\d+>\\(([^)]*)\\);`))![1];
  return body.split(",").map((text) => text.trim()).filter(Boolean).map(Number);
}

describe("embedded-rule shader export", () => {
  it("writes every weight back to the same float32: 7,776 for a single-scale cellular model, 17,088 for a two-scale one", () => {
    for (const material of kinds) {
      const source = embeddedRuleShaderSource(material.file, material.values);
      const names = material.file.rule.layout === "figure-pyramid-16-96-torus-v1" ? ["W1C", "B1C", "W2C", "W1F", "B1F", "W2F"] : ["W1", "B1", "W2"];
      const written = names.flatMap((name) => literals(source, name));
      expect(written).toHaveLength(material.values.length);
      expect(Float32Array.from(written)).toEqual(material.values);
    }
    expect([0, -0.5, 1e-7, 3.4e38].map((value) => Math.fround(Number(wgslFloat(value))))).toEqual([0, -0.5, Math.fround(1e-7), Math.fround(3.4e38)]);
  });

  it("keeps each free-text field on its own comment line, whatever line break it holds", () => {
    // The loader refuses these characters; the export keeps its comments to one line without relying on that.
    // WGSL ends a line comment at LF, VT, FF, CR, NEL, U+2028 and U+2029.
    const breaks = [0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029].map((code) => String.fromCodePoint(code));
    const wgslLines = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/;
    for (const material of [cell, pyramid]) {
      for (const lineBreak of breaks) {
        const marker = (field: string) => `${lineBreak}const INJECTED_${field}: u32 = 1u;${lineBreak}//`;
        const file = {
          ...material.file, name: `Scales${marker("NAME")}`, id: `seed${marker("ID")}`, trainerCommit: `abc${marker("COMMIT")}`,
          recipe: { ...material.file.recipe, name: `figure${marker("RECIPE")}`, source: `src${marker("SOURCE")}`, sourceSha256: `0${marker("SHA")}` },
        };
        const code = embeddedRuleShaderSource(file, material.values).split(wgslLines).filter((line) => !line.trimStart().startsWith("//"));
        expect(code.filter((line) => line.includes("INJECTED")), lineBreak.codePointAt(0)!.toString(16)).toEqual([]);
      }
    }
  });

  it("records provenance and embeds the runtime step without external rule weights", () => {
    const material = cell;
    const source = embeddedRuleShaderSource(material.file, material.values);
    expect(source).toContain(material.file.recipe.sourceSha256);
    expect(source).toContain("const FIRE_RATE: f32 = 0.500000000;");
    expect(source).toContain(FIGURE_WGSL.step);
    expect(source).not.toMatch(/\brule\[/);
    expect(embeddedRuleShaderName(material.file)).toBe(`${material.file.id}.wgsl`);
    expect(source).toContain("const START_DISC: f32 = 0.00000000;");
  });

  it("embeds the pyramid's two grids: both steps and the torus upsampling", () => {
    const source = embeddedRuleShaderSource(pyramid.file, pyramid.values);
    expect(source).toContain(FIGURE_WGSL.step);
    expect(source).toContain(FIGURE_WGSL.fineStep);
    expect(source).toContain(FIGURE_WGSL.torus);
    expect(source).toContain("fn rule_fire_key() -> u32 { return COARSE_FIRE_KEY; }");
    expect(source).not.toMatch(/\brule\[/);
  });

  it("embeds a seeded start's disc into start_state, half the radius on the pyramid's coarse grid", () => {
    const source = embeddedRuleShaderSource(seededCell.file, seededCell.values);
    expect(source).toContain("const START_DISC: f32 = 16.0000000;");
    expect(source).toContain(FIGURE_WGSL.start);
    const both = embeddedRuleShaderSource(seededPyramid.file, seededPyramid.values);
    expect(both).toContain("const START_DISC: f32 = 16.0000000;");
    expect(both).toContain(FIGURE_WGSL.start);
    expect(both).toContain("const START_BACKGROUND: f32 = 0.00000000;");
    const field = { ...seededPyramid.file, start: { kind: "centre-disc" as const, radius: 16, backgroundAmplitude: 0.25 } };
    expect(embeddedRuleShaderSource(field, seededPyramid.values)).toContain("const START_BACKGROUND: f32 = 0.250000000;");
  });
});
