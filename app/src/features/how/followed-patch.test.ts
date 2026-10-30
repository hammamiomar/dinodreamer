import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOW_PICTURE } from "./how-source";
import { PREFIX, WINNERS } from "./how-shapes";
import { decodeAddresses } from "./recorded";

const material = JSON.parse(readFileSync(new URL("../../../../gallery/seed/materials/block-4009-figure-pyramid-strongest-seed-0.material.json", import.meta.url), "utf8"));
const bytes = readFileSync(new URL("../../../public/how/recorded/picture-2985056820452196/addresses.bin", import.meta.url));
const addresses = decodeAddresses(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const passes = JSON.parse(readFileSync(new URL("../../../public/how/training/featurizer-passes.json", import.meta.url), "utf8"));

describe("the followed patch across How and its records", () => {
  it("follows the material's target after excluding the five prefix tokens", () => {
    expect(HOW_PICTURE.imageId).toBe(material.anchor.imageId);
    expect(HOW_PICTURE.patch + PREFIX).toBe(material.anchor.slot);
    const offset = HOW_PICTURE.patch * WINNERS;
    const rank = Array.from(addresses.blocks.slice(offset, offset + WINNERS)).indexOf(HOW_PICTURE.block);
    expect(rank).toBeGreaterThanOrEqual(0);
    const code = addresses.codes.slice((offset + rank) * 3, (offset + rank + 1) * 3);
    const distance = Math.hypot(...Array.from(code, (value, axis) => value - material.anchor.code[axis]));
    // The recording reads the published 8-bit PNG; the library read its pre-quantized view.
    expect(distance).toBeLessThan(0.01 * material.anchor.norm);
  });

  it("uses that target's recorded winners in the final featurizer pass", () => {
    expect(passes.imageId).toBe(material.anchor.imageId);
    expect(passes.slot).toBe(material.anchor.slot);
    const patch = passes.slot - PREFIX;
    const winners = Array.from(addresses.blocks.slice(patch * WINNERS, (patch + 1) * WINNERS));
    expect(passes.passes.at(-1).groups).toEqual(winners);
  });
});
