import { describe, expect, it } from "vitest";
import { createRunState, type RunState } from "./session";
import { showsStoredPicture } from "./stage-image";
import type { OpenedPicture } from "../state";

const picture: OpenedPicture = { png: new Uint8Array([1]), step: 150, opened: 2, revision: 5 };
const measured = (state: RunState): RunState => ({
  ...state,
  measurement: { revision: 5, step: 150, terms: [], codes: [], pixels: new Uint8ClampedArray(4), receivedAt: 0 },
});

describe("what the stage shows for a reopened creation", () => {
  it("shows the saved picture before the run is asked, and while its restore waits or is in flight", () => {
    expect(showsStoredPicture(picture, createRunState())).toBe(true);
    const waiting: RunState = { ...createRunState(), restore: { picture: picture.png, step: 150, afterRevision: 5, opened: 2, sent: true } };
    expect(showsStoredPicture(picture, measured(waiting))).toBe(true);
  });

  it("shows the run once the picture is restored or dropped, and once the run shows an image unasked", () => {
    expect(showsStoredPicture(picture, measured({ ...createRunState(), restoreOutcome: { opened: 2, result: "restored" } }))).toBe(false);
    expect(showsStoredPicture(picture, { ...createRunState(), restoreOutcome: { opened: 2, result: "dropped" } })).toBe(false);
    expect(showsStoredPicture(picture, measured(createRunState()))).toBe(false);
  });

  it("ignores the outcome of another creation's restore, and shows nothing stored without a picture", () => {
    expect(showsStoredPicture(picture, { ...createRunState(), restoreOutcome: { opened: 1, result: "restored" } })).toBe(true);
    expect(showsStoredPicture(null, createRunState())).toBe(false);
  });
});
