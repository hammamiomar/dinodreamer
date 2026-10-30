import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fires, readStory, type Story, type StoryRecord } from "./training-story";

/** The story the app serves, as engine/tools/prepare_training_demonstration.py wrote it. */
const prepared = JSON.parse(readFileSync(new URL("../../../public/story/story.json", import.meta.url), "utf8")) as unknown;

function record(material: string, block = 12002): StoryRecord {
  return {
    material,
    block,
    anchor: { imageId: 3536804379159069, slot: 74, band: "strongest", atlasPoint: [14.9, -1.2], atlasPlane: [[1, 0, 0], [0, 1, 0]] },
    training: {
      strip: `${material}-training.webp`,
      frameSide: 128,
      tick: 600,
      medianNorm: 5.32,
      frames: [
        { update: 25, winnerFraction: 0, strength: 0.16 },
        { update: 200, winnerFraction: 0.7, strength: 1.2 },
        { update: 225, winnerFraction: 0.97, strength: 1.52 },
      ],
    },
    run: "research/x",
  };
}

const story: Story = { release: "pass-003", atlasDomain: { xMin: -25, xMax: 35, yMaximum: 25 }, records: [record("a"), record("b"), record("c")] };

describe("the prepared story", () => {
  test("the file the app serves passes the boundary check, and every record ends at its first fire", () => {
    const served = readStory(prepared);
    expect(served.records.length).toBeGreaterThan(0);
    for (const entry of served.records) {
      const frames = entry.training.frames;
      expect(frames.at(-1)!.winnerFraction).toBeGreaterThanOrEqual(0.9);
      expect(frames.slice(0, -1).every((frame) => frame.winnerFraction < 0.9)).toBe(true);
      expect(entry.training.strip.startsWith(entry.material)).toBe(true);
    }
  });

  test("refuses a story whose last readout does not fire, or whose strip names a path", () => {
    const unfired = structuredClone(story);
    unfired.records[0]!.training.frames.at(-1)!.winnerFraction = 0.5;
    expect(() => readStory({ ...unfired, format: 1 })).toThrow(/must meet the selection target/);
    const pathed = structuredClone(story);
    pathed.records[0]!.training.strip = "../escape.webp";
    expect(() => readStory({ ...pathed, format: 1 })).toThrow(/strip/);
    expect(() => readStory({ ...story, format: 2 })).toThrow(/format/);
  });
});

describe("a training readout", () => {
  test("a training frame fires on its wins alone, at FIRES of the patches", () => {
    expect(fires({ update: 225, winnerFraction: 0.97, strength: 1.52 })).toBe(true);
    expect(fires({ update: 200, winnerFraction: 0.7, strength: 1.2 })).toBe(false);
    expect(fires({ update: 1, winnerFraction: 0.9, strength: 0.1 })).toBe(true);
  });
});
