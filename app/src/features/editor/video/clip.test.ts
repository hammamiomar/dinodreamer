import { describe, expect, it } from "vitest";
import type { Still } from "../run/recording";
import { chooseEncoder, savedFileName, clipStills, planClip } from "./clip";

const stills = (count: number): Still[] => Array.from({ length: count }, (_, step) => ({ step, blob: new Blob([String(step)]) }));

describe("the clip's cadence", () => {
  it("shows one still per frame and holds the last one for two seconds", () => {
    const plan = planClip(stills(3));
    expect(plan.map((frame) => frame.repeat)).toEqual([1, 1, 60]);
    expect(plan.map((frame) => frame.still.step)).toEqual([0, 1, 2]);
  });

  it("ends on the image on screen when it is newer than the last still, and never repeats one", () => {
    const kept = stills(3);
    const newer = { step: 3, blob: new Blob(["3"]) };
    expect(clipStills(kept, newer).map((still) => still.step)).toEqual([0, 1, 2, 3]);
    expect(clipStills(kept, { step: 2, blob: new Blob(["2"]) })).toBe(kept);
    expect(clipStills(kept)).toBe(kept);
    expect(clipStills([], newer)).toEqual([]);
  });
});

describe("the clip's file name", () => {
  it("is the title and the step with the encoder's extension", () => {
    expect(savedFileName("Collar and ball", 240, "mp4")).toBe("Collar and ball-240.mp4");
    expect(savedFileName("  Untitled canvas ", 7, "gif")).toBe("Untitled canvas-7.gif");
  });

  it("replaces characters a file name cannot carry, and names an empty title", () => {
    expect(savedFileName("a/b:c*d?e\"f<g>h|i", 1, "mp4")).toBe("a-b-c-d-e-f-g-h-i-1.mp4");
    expect(savedFileName("   ", 3, "mp4")).toBe("canvas-3.mp4");
    expect(savedFileName("///", 3, "gif")).toBe("canvas-3.gif");
    // A saved image is named the same way.
    expect(savedFileName("  Untitled canvas ", 12, "png")).toBe("Untitled canvas-12.png");
  });
});

describe("the choice of encoder", () => {
  it("takes MP4 when the browser encodes H.264, else GIF", async () => {
    expect((await chooseEncoder(async () => true)).extension).toBe("mp4");
    expect((await chooseEncoder(async () => false)).extension).toBe("gif");
  });
});
