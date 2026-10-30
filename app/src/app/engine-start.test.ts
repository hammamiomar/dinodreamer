import { describe, expect, it } from "vitest";
import { engineWanted } from "./engine-start";

describe("when the engine starts", () => {
  it("does not start for a visitor who reads the landing or browses", () => {
    expect(engineWanted("/", 0)).toBe(false);
    expect(engineWanted("/index", 0)).toBe(false);
    expect(engineWanted("/basis/7125", 0)).toBe(false);
    expect(engineWanted("/gallery", 0)).toBe(false);
  });

  it("starts on Create, with a request, or during a token drag", () => {
    expect(engineWanted("/create", 0)).toBe(true);
    expect(engineWanted("/create/basis/7125", 0)).toBe(true);
    expect(engineWanted("/index", 1)).toBe(true);
  });
});
