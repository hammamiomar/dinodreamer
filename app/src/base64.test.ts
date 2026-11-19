import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64";

describe("base64 binary codec", () => {
  it("round-trips empty, small, and multi-chunk payloads", () => {
    const empty = new Uint8Array(0);
    expect(encodeBase64(empty)).toBe("");
    expect(decodeBase64("")).toEqual(empty);

    const small = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(decodeBase64(encodeBase64(small))).toEqual(small);

    // Exceeds a single 32 KiB chunk to exercise multi-chunk encoding.
    const large = new Uint8Array(70_000);
    for (let index = 0; index < large.length; index++) {
      large[index] = (index * 31) & 0xff;
    }
    expect(decodeBase64(encodeBase64(large))).toEqual(large);
  });

  it("throws on malformed base64 input", () => {
    expect(() => decodeBase64("not!valid!base64")).toThrow();
  });
});
