import { describe, expect, test } from "vitest";
import { fillNodes } from "./fill-nodes";
import { fill, SITE_WORDS } from "./site-words";

function expectPlaceholders(text: string, names: readonly string[]): void {
  for (const name of names) expect(text).toContain(`{${name}}`);
}

describe("site copy helpers and placeholders", () => {
  test("fill substitutes known placeholders and preserves unknown ones", () => {
    expect(fill("Block {block} · {kind}", { block: 12002, kind: "fine rule" })).toBe("Block 12002 · fine rule");
    expect(fill("Data: release {release}", {})).toBe("Data: release {release}");
  });

  test("fillNodes splits text around placeholders for inline React nodes", () => {
    const pieces = fillNodes("The dictionary has {blocks}, learned from DINOv3.", { blocks: "16,384 blocks" });
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toBe("The dictionary has ");
    expect(pieces[2]).toBe(", learned from DINOv3.");
  });

  test("every leaf entry is a string and required placeholders exist", () => {
    const leaves = (value: unknown): unknown[] =>
      value !== null && typeof value === "object" ? Object.values(value).flatMap(leaves) : [value];
    for (const group of Object.values(SITE_WORDS)) {
      for (const word of leaves(group)) expect(typeof word).toBe("string");
    }

    expectPlaceholders(SITE_WORDS.home.properties.openGroup, ["block"]);
    expectPlaceholders(SITE_WORDS.home.collection.heading, ["lit", "total", "unlit"]);
    expectPlaceholders(SITE_WORDS.home.collection.cloudSummary, ["patches"]);
    expectPlaceholders(SITE_WORDS.home.train.tableCaption, ["filled", "total", "block"]);
    expectPlaceholders(SITE_WORDS.home.keep.parameters, ["count"]);
    expectPlaceholders(SITE_WORDS.home.kind, ["rule"]);
    expectPlaceholders(SITE_WORDS.stage.readingToward, ["band"]);
    expectPlaceholders(SITE_WORDS.stage.readingStrength, ["strength"]);
    expectPlaceholders(SITE_WORDS.stage.frameGrid, ["side"]);
    expectPlaceholders(SITE_WORDS.stage.canvasName, ["title"]);
    expectPlaceholders(SITE_WORDS.stage.record, ["seconds"]);

    const grow = SITE_WORDS.grow;
    for (const time of [grow.timeBefore, grow.timeLeft, grow.timeTaken]) {
      expectPlaceholders(time, ["updates", "duration"]);
    }
    for (const counter of [grow.update, grow.firstFire, grow.fired]) {
      expectPlaceholders(counter, ["update"]);
    }
    expectPlaceholders(grow.readerLoading, ["loaded", "all"]);
    for (const reading of [grow.reading, grow.readingCentre]) {
      expectPlaceholders(reading, ["group", "selected", "patches", "needed"]);
    }
    for (const hint of [grow.coSelectedHint, grow.coSelectedHintCentre]) {
      expectPlaceholders(hint, ["patches", "group", "needed"]);
    }
    expectPlaceholders(grow.seconds, ["seconds"]);
    expectPlaceholders(grow.minutes, ["minutes"]);
    for (const text of [grow.choosing, grow.noStrongest, grow.canvasLabel]) {
      expectPlaceholders(text, ["block"]);
    }
  });
});
