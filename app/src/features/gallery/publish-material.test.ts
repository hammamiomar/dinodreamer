import { afterEach, describe, expect, it, vi } from "vitest";
import { publishState, readSubmittedMaterials } from "./publish-material";
import type { FigureMaterialFile } from "../../materials/material-file";

afterEach(() => vi.unstubAllGlobals());

describe("stored material submissions", () => {
  it.each(["null", "[]", "42", '"text"', "invalid"]) ("ignores invalid stored data: %s", (text) => {
    vi.stubGlobal("localStorage", { getItem: () => text });
    expect(readSubmittedMaterials()).toEqual({});
  });
  it("keeps valid entries when another entry is malformed", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ valid: { id: "submission", at: "date" }, invalid: null }) });
    expect(readSubmittedMaterials()).toEqual({ valid: { id: "submission", at: "date" } });
  });
  it("does not interpret inherited properties as submissions", () => {
    expect(publishState({ id: "constructor" } as FigureMaterialFile, new Set(), {})).toBe("idle");
  });
});
