import { describe, expect, it } from "vitest";
import {
  assertUnsigned32,
  decodeArray,
  decodeBoolean,
  decodeInteger,
  decodeNonEmptyString,
  decodeNullable,
  decodeNumber,
  decodeObject,
  decodeString,
  decodeUnsigned32,
  isUnsigned32,
  MAX_UINT32,
} from "./decode";

describe("primitive JSON decoders", () => {
  it("accepts valid primitives and arrays", () => {
    expect(decodeObject({ a: 1 }, "root")).toEqual({ a: 1 });
    expect(decodeArray([1, 2], "list", decodeInteger)).toEqual([1, 2]);
    expect(decodeNullable(null, "opt", decodeString)).toBeNull();
    expect(decodeNullable(undefined, "opt", decodeString)).toBeNull();
    expect(decodeNullable("ok", "opt", decodeString)).toBe("ok");
    expect(decodeString("", "text")).toBe("");
    expect(decodeNonEmptyString("ok", "text")).toBe("ok");
    expect(decodeNumber(3.5, "num")).toBe(3.5);
    expect(decodeInteger(-42, "int")).toBe(-42);
    expect(decodeBoolean(false, "flag")).toBe(false);
    expect(decodeUnsigned32(0, "seed")).toBe(0);
    expect(decodeUnsigned32(MAX_UINT32, "seed")).toBe(MAX_UINT32);
  });

  it("rejects wrong types with path-scoped messages and supports custom formatters", () => {
    expect(() => decodeObject(null, "x")).toThrow("x: expected an object");
    expect(() => decodeObject([], "x")).toThrow("x: expected an object");
    expect(() => decodeArray({}, "xs", decodeInteger)).toThrow("xs: expected an array");
    expect(() => decodeArray([1, "bad"], "xs", decodeInteger)).toThrow("xs[1]: expected an integer");
    expect(() => decodeString(1, "s")).toThrow("s: expected a string");
    expect(() => decodeNonEmptyString("", "s")).toThrow("s: expected a non-empty string");
    expect(() => decodeNumber(Number.NaN, "n")).toThrow("n: expected a finite number");
    expect(() => decodeNumber(Number.POSITIVE_INFINITY, "n")).toThrow("n: expected a finite number");
    expect(() => decodeInteger(1.5, "i")).toThrow("i: expected an integer");
    expect(() => decodeBoolean("true", "b")).toThrow("b: expected a boolean");
    expect(() => decodeUnsigned32(-1, "u")).toThrow("u: expected an unsigned 32-bit integer");
    expect(() => decodeUnsigned32(MAX_UINT32 + 1, "u")).toThrow("u: expected an unsigned 32-bit integer");

    const custom = (label: string) => `Invalid ${label}`;
    expect(() => decodeNonEmptyString("", "name", custom)).toThrow("Invalid name");
  });

  it("validates unsigned 32-bit integers via isUnsigned32 and assertUnsigned32", () => {
    expect(isUnsigned32(0)).toBe(true);
    expect(isUnsigned32(MAX_UINT32)).toBe(true);
    expect(isUnsigned32(-1)).toBe(false);
    expect(isUnsigned32(MAX_UINT32 + 1)).toBe(false);
    expect(isUnsigned32(1.5)).toBe(false);
    expect(isUnsigned32(Number.NaN)).toBe(false);

    expect(assertUnsigned32(42, "Seed")).toBe(42);
    expect(() => assertUnsigned32(-1, "Seed")).toThrow("Seed must be an unsigned 32-bit integer.");
  });
});
