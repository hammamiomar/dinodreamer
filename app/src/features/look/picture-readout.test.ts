import { describe, expect, it } from "vitest";
import type { ImageAddresses } from "../../reader/protocol";
import { centreSquare, pictureReadout } from "./picture-readout";

function addresses(): ImageAddresses {
  const rows = 256 * 32;
  return {
    dictionaryId: "test-dictionary",
    grid: 16,
    blocks: Uint16Array.from({ length: rows }, (_, index) => index % 32 + 100),
    norms: Float32Array.from({ length: rows }, (_, index) => 32 - index % 32),
    codes: Float32Array.from({ length: rows * 3 }, (_, index) => index % 3 === 0 ? 32 - Math.floor(index / 3) % 32 : 0),
  };
}

describe("an uploaded picture's addresses", () => {
  it("groups exact native codes by block and preserves patch slots without library IDs", () => {
    const read = pictureReadout(addresses());
    expect(read.blocks).toHaveLength(32);
    expect(read.blocks[0].block).toBe(100);
    expect(read.blocks[0].meanNorm).toBe(32);
    expect(read.byBlock.get(100)).toBe(read.blocks[0]);
    expect(read.blocks[0].tokens[0]).toEqual({ source: "upload", code: [32, 0, 0], norm: 32, slot: 5 });
    expect(read.blocks[0].tokens[255].slot).toBe(260);
    expect(read.blocks.reduce((sum, entry) => sum + entry.tokens.length, 0)).toBe(8192);
  });

  it("orders by patch coverage before strength", () => {
    const read = addresses();
    read.blocks[0] = 99;
    const blocks = pictureReadout(read).blocks;
    expect(blocks[0].block).toBe(101);
    expect(blocks.at(-1)?.block).toBe(99);
    expect(blocks.at(-2)?.block).toBe(100);
  });

  it("rejects incomplete, duplicate and nonfinite results at the reader boundary", () => {
    const short = addresses();
    short.codes = short.codes.slice(3);
    expect(() => pictureReadout(short)).toThrow("complete");
    const duplicate = addresses();
    duplicate.blocks[0] = duplicate.blocks[1];
    expect(() => pictureReadout(duplicate)).toThrow("invalid");
    const nonfinite = addresses();
    nonfinite.norms[1] = Infinity;
    expect(() => pictureReadout(nonfinite)).toThrow("invalid");
  });
});

it("shows the exact centred square that the reader will receive", () => {
  expect(centreSquare(800, 400)).toEqual({ x: 200, y: 0, side: 400 });
  expect(centreSquare(400, 800)).toEqual({ x: 0, y: 200, side: 400 });
  expect(centreSquare(400, 400)).toEqual({ x: 0, y: 0, side: 400 });
  expect(() => centreSquare(0, 400)).toThrow();
});
