import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readFigureMaterial } from "../materials/material-file";
import {
  COARSE_NOISE_KEY, displayByte, fires, hiddenNoiseDraw, pcg, pictureBytes, PYRAMID_RULE_VALUES, pyramidPictureBytes, referencePyramidStep,
  referenceStamp, referenceStep, startState, upsampleTorus,
} from "./figure-reference";
import fixture from "./figure-step.fixture.json";
import pyramidFixture from "./pyramid-step.fixture.json";

const material = readFigureMaterial(JSON.parse(readFileSync(
  new URL("../../fixtures/materials/block-12002-figure-strongest-mean-seed-1.material.json", import.meta.url), "utf8")));
const pyramid = readFigureMaterial(JSON.parse(readFileSync(
  new URL("../../../gallery/seed/materials/block-4009-figure-pyramid-strongest-seed-0.material.json", import.meta.url), "utf8")));

function relativeRms(actual: Float32Array, expected: Float32Array): number {
  let squared = 0;
  let norm = 0;
  for (let index = 0; index < expected.length; index++) {
    squared += (actual[index] - expected[index]) ** 2;
    norm += expected[index] ** 2;
  }
  return Math.sqrt(squared / norm);
}

function floats(encoded: string): Float32Array {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

async function sha256(values: Float32Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", values.slice().buffer));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

describe("figure replay contract", () => {
  it("hashes u32 values like numpy's wrapping PCG", () => {
    expect([0, 1, 2, 0xffffffff, 0x6e6f6973 ^ 1].map(pcg)).toEqual([129708002, 2831084092, 2055130248, 3861530882, 2898914898]);
  });

  it("starts from the same float32 noise as the trainer oracle, bit for bit", () => {
    expect(startState(fixture.side, fixture.seed)).toEqual(floats(fixture.statesFloat32Base64["0"]));
  });

  it("keeps a seeded start's noise only inside the centre disc: 812 cells at radius 16 on 128", () => {
    const noise = startState(128, 1);
    const seeded = startState(128, 1, 16);
    let inside = 0;
    for (let cell = 0; cell < 128 * 128; cell++) {
      const values = seeded.subarray(cell * 16, cell * 16 + 16);
      if (values.some((value) => value !== 0)) {
        inside++;
        expect(values).toEqual(noise.subarray(cell * 16, cell * 16 + 16));
      }
      const [x, y] = [cell % 128, Math.floor(cell / 128)];
      if (x < 48 || x > 79 || y < 48 || y > 79) expect(values.every((value) => value === 0)).toBe(true);
    }
    expect(inside).toBe(812);
  });

  it("upsamples a coarse grid bilinearly with clamped edges at 2 pixels per cell, as torch's interpolate", () => {
    // Two cells in a row whose red values show as 0 and 1; green and blue at 0.5.
    const state = new Float32Array(2 * 2 * 16);
    for (let cell = 0; cell < 4; cell++) state[cell * 16] = cell % 2 === 0 ? -0.5 : 0.5;
    const bytes = pictureBytes(state, 2, 2);
    const red = Array.from({ length: 4 }, (_, x) => bytes[x * 4]);
    // Pixel 0 clamps to cell 0; pixels 1 and 2 weigh the two cells 0.75/0.25; pixel 3 clamps to cell 1.
    expect(red).toEqual([0, 64, 191, 255]);
    expect(bytes[1]).toBe(128);
    expect(Array.from(pictureBytes(state, 2, 1)).filter((_, index) => index % 4 === 0)).toEqual([0, 255, 0, 255]);
  });

  it("fires about half the cells at rate 0.5 and none at a vanishing rate", () => {
    const cells = Array.from({ length: 16384 }, (_, cell) => fires(1, 3, cell, 0.5));
    const fraction = cells.filter(Boolean).length / cells.length;
    expect(Math.abs(fraction - 0.5)).toBeLessThan(0.02);
    expect(fires(1, 3, 0, 2 ** -30)).toBe(false);
  });

  it("matches the trainer's CellRule for three ticks from the same weights, noise and masks", async () => {
    expect(await sha256(material.values)).toBe(fixture.ruleValuesSha256);
    let state = startState(fixture.side, fixture.seed);
    for (let tick = 0; tick < 3; tick++) {
      state = referenceStep(state, material.values, fixture.side, fixture.seed, tick, fixture.fireRate);
      const expected = floats(fixture.statesFloat32Base64[String(tick + 1) as "1" | "2" | "3"]);
      let squared = 0;
      let norm = 0;
      for (let index = 0; index < expected.length; index++) {
        squared += (state[index] - expected[index]) ** 2;
        norm += expected[index] ** 2;
      }
      expect(Math.sqrt(squared / norm)).toBeLessThan(1e-6);
    }
  });

  it("matches PyramidRule for three ticks on both grids from the same weights, noise and masks", async () => {
    expect(pyramid.values).toHaveLength(PYRAMID_RULE_VALUES);
    expect(await sha256(pyramid.values)).toBe(pyramidFixture.ruleValuesSha256);
    const { side, seed, fireRate } = pyramidFixture;
    const states = pyramidFixture.statesFloat32Base64 as Record<string, { fine: string; coarse: string }>;
    let fine = startState(side, seed);
    let coarse = startState(side / 2, seed, 0, COARSE_NOISE_KEY);
    expect(fine).toEqual(floats(states["0"].fine));
    expect(coarse).toEqual(floats(states["0"].coarse));
    for (let tick = 0; tick < 3; tick++) {
      ({ fine, coarse } = referencePyramidStep(fine, coarse, pyramid.values, side, seed, tick, fireRate));
      expect(relativeRms(coarse, floats(states[String(tick + 1)].coarse))).toBeLessThan(1e-6);
      expect(relativeRms(fine, floats(states[String(tick + 1)].fine))).toBeLessThan(1e-6);
    }
  });

  it("upsamples the coarse grid on the torus: weights 0.25/0.75 and wrap at the edges", () => {
    // A 2-cell coarse row (4 x 2 cells, one channel set) with values 0 and 1 in channel 0.
    const coarse = new Float32Array(2 * 2 * 16);
    for (let cell = 0; cell < 4; cell++) coarse[cell * 16] = cell % 2;
    // Fine x = 0 reads coarse -0.25: 0.25 of cell 1 (wrapped) and 0.75 of cell 0.
    expect([0, 1, 2, 3].map((x) => upsampleTorus(coarse, 2, x, 0, 0))).toEqual([0.25, 0.25, 0.75, 0.75]);
    const fine = new Float32Array(4 * 4 * 16);
    expect(pyramidPictureBytes(fine, coarse, 4)[0]).toBe(191);
  });

  it("draws standard normal hidden-channel noise from the hash", () => {
    const draws = Array.from({ length: 20000 }, (_, index) => hiddenNoiseDraw(7, 11, index >> 4, 3 + (index % 13)));
    const mean = draws.reduce((total, value) => total + value, 0) / draws.length;
    const variance = draws.reduce((total, value) => total + (value - mean) ** 2, 0) / draws.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });

  it("rounds displayed values half to even, as torch.round does", () => {
    expect(displayByte(-1)).toBe(0);
    expect(displayByte(2)).toBe(255);
    expect(displayByte(0)).toBe(128);
    expect(displayByte(0.5 / 255 - 0.5)).toBe(0);
    expect(displayByte(1.5 / 255 - 0.5)).toBe(2);
  });
});

describe("brush stamp", () => {
  it("writes grey into R, G and B and start values into the hidden channels at full weight, and leaves far cells alone", () => {
    const side = 32;
    const state = startState(side, 3);
    const after = referenceStamp(state, side, 3, 0, 16, 16, 8);
    const centre = (16 * side + 16) * 16;
    expect(after[centre]).toBe(after[centre + 1]);
    expect(after[centre + 1]).toBe(after[centre + 2]);
    expect(Math.abs(after[centre])).toBeLessThan(0.1);
    expect(after[centre + 5]).not.toBe(state[centre + 5]);
    const far = (0 * side + 0) * 16;
    expect(after.slice(far, far + 16)).toEqual(state.slice(far, far + 16));
    const edge = (16 * side + 23) * 16; // 7 cells out: inside the soft edge, so only part of the way
    expect(after[edge]).not.toBe(state[edge]);
    expect(after[edge + 1]).not.toBe(after[edge]);
  });
});
