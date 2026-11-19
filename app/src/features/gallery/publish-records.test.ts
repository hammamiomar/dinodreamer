import { afterEach, describe, expect, it, vi } from "vitest";
import { publishState, readSavedFromGallery, readSubmittedMaterials, type PublishRecords } from "./publish-records";
import type { FigureMaterialFile } from "../../materials/material-file";

afterEach(() => vi.unstubAllGlobals());

describe("stored material submissions", () => {
  it.each(["null", "[]", "42", '"text"', "invalid"]) ("ignores invalid stored data: %s", (text) => {
    vi.stubGlobal("localStorage", { getItem: () => text });
    expect(readSubmittedMaterials()).toEqual({});
    expect(readSavedFromGallery()).toEqual({});
  });
  it("keeps valid entries when another entry is malformed", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ valid: { id: "submission", at: "date" }, invalid: null }) });
    expect(readSubmittedMaterials()).toEqual({ valid: { id: "submission", at: "date" } });
  });
  it("does not interpret inherited properties as submissions", () => {
    expect(publishState({ id: "constructor" } as FigureMaterialFile, new Set(), { sent: {}, savedFrom: {} })).toBe("idle");
  });
});

describe("where a kept automaton stands", () => {
  const file = { id: "grow-figure-12002-3536804379159069-74-seed-20273024-batch-4-update-1000-final" } as FigureMaterialFile;
  const none: PublishRecords = { sent: {}, savedFrom: {} };
  const sentAs = (submission: string): PublishRecords => ({ sent: { [file.id]: { id: submission, at: "2026-11-18T22:00:00Z" } }, savedFrom: {} });
  const savedFrom = (entry: string): PublishRecords => ({ sent: {}, savedFrom: { [file.id]: { entry, at: "2026-11-18T22:00:00Z" } } });

  it("is idle when this browser neither sent it nor saved it from the gallery, whatever another automaton's file claims", () => {
    // Another visitor's approved file with the same own id is entry 20261118-232426-320e368c; its id is not this file's record.
    expect(publishState(file, new Set(["20261118-232426-320e368c"]), none)).toBe("idle");
  });

  it("is awaiting while this browser's submission is not shown, and published once it is", () => {
    expect(publishState(file, new Set(["20261118-232426-320e368c"]), sentAs("20261119-080000-0a0b0c0d"))).toBe("awaiting");
    expect(publishState(file, new Set(["20261119-080000-0a0b0c0d"]), sentAs("20261119-080000-0a0b0c0d"))).toBe("published");
  });

  it("is published when it was saved from a gallery automaton that is still shown, and idle once that one is gone", () => {
    expect(publishState(file, new Set(["20261118-232426-320e368c"]), savedFrom("20261118-232426-320e368c"))).toBe("published");
    expect(publishState(file, new Set(), savedFrom("20261118-232426-320e368c"))).toBe("idle");
  });
});
