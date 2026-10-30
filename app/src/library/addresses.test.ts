import { describe, expect, it } from "vitest";
import { TOKEN_SLOTS, type AddressBlock } from "../recipe";
import { ADDRESS_BLOCKS, ADDRESS_FILE_BYTES, ADDRESS_ROW_BYTES, decodeAddressRow, encodeAddressRow } from "./addresses";

const token = { imageId: 6177164541157906, role: "patch" as const, slot: 189 };
/** 32 distinct blocks, strongest first, with codes that a float32 holds exactly. */
const blocks: AddressBlock[] = Array.from({ length: ADDRESS_BLOCKS }, (_, rank) => ({
  block: 16383 - rank * 100,
  code: [8 - rank * 0.25, -0.5, rank * 0.125],
}));

describe("address rows", () => {
  it("are 32 winners of 14 bytes: 448 bytes a row, 116,928 a file", () => {
    expect(ADDRESS_ROW_BYTES).toBe(448);
    expect(ADDRESS_FILE_BYTES).toBe(TOKEN_SLOTS * 448);
    expect(ADDRESS_FILE_BYTES).toBe(116_928);
  });

  it("decode to the token's blocks in file order, each with its code", () => {
    const row = encodeAddressRow(blocks);
    expect(row.byteLength).toBe(ADDRESS_ROW_BYTES);
    expect(decodeAddressRow(row.buffer, token)).toEqual({ token, blocks });
    // Little-endian and unaligned: the second winner's block starts at byte 14.
    expect(new DataView(row.buffer).getUint16(14, true)).toBe(16283);
  });

  it("refuse a short row and a block listed twice", () => {
    expect(() => decodeAddressRow(new ArrayBuffer(447), token)).toThrow("the selected responses of slot 189 are 447 bytes, not 448");
    const twice = blocks.map((entry, rank) => (rank === 5 ? { ...entry, block: blocks[0]!.block } : entry));
    expect(() => decodeAddressRow(encodeAddressRow(twice).buffer, token)).toThrow("the selected responses of slot 189 list basis group 16383 twice");
  });
});
