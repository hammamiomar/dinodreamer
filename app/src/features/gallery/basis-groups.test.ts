import { describe, expect, it } from "vitest";
import { checkedName, nameOf, NO_NAMES, readBasisGroupNames, withName } from "./basis-groups";

describe("the owner's names for the basis groups", () => {
  it("sets, keeps and clears a name, and leaves the names alone when nothing changes", () => {
    const names = withName(NO_NAMES, 729, "  light on glass ");
    expect(names).toEqual({ "729": { name: "light on glass" } });
    expect(withName(names, 729, "light on glass")).toBe(names);
    expect(withName(names, 12240, "")).toBe(names);
    expect(withName(names, 729, " ")).toEqual({});
    expect(nameOf(names, 729)).toBe("light on glass");
    expect(nameOf(names, 12240)).toBeNull();
    expect(() => withName(names, 729, "a\u0007bell")).toThrow("control characters");
    expect(checkedName("x".repeat(81))).toBeNull();
  });

  it("reads the stored object once and refuses a bad block or name", () => {
    expect(readBasisGroupNames({ "729": { name: "light on glass" } })).toEqual({ "729": { name: "light on glass" } });
    expect(() => readBasisGroupNames([])).toThrow("invalid object");
    expect(() => readBasisGroupNames({ "16384": { name: "forks" } })).toThrow("invalid block number");
    expect(() => readBasisGroupNames({ "729": { name: " forks" } })).toThrow("invalid name of 729");
    expect(() => readBasisGroupNames({ "729": { name: "" } })).toThrow("invalid name of 729");
  });
});
