import { describe, expect, test } from "vitest";
import { fill, fillNodes, SITE_WORDS } from "./site-words";

describe("the site's words", () => {
  test("a placeholder takes its value; one with no value stays, so a missing name shows itself", () => {
    expect(fill("Block {block} · {kind}", { block: 12002, kind: "fine rule" })).toBe("Block 12002 · fine rule");
    expect(fill("Data: release {release}", {})).toBe("Data: release {release}");
  });

  test("a string splits around its placeholders, so a link can stand in one", () => {
    const pieces = fillNodes("The dictionary has {blocks}, learned from DINOv3.", { blocks: "16,384 blocks" });
    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toBe("The dictionary has ");
    expect(pieces[2]).toBe(", learned from DINOv3.");
  });

  test("every word is a plain string, and the placeholders the components fill exist", () => {
    // A group holds strings, or objects and arrays of strings where a page's words come in
    // sections (How's sections, glossary and references); every leaf is a string.
    const leaves = (value: unknown): unknown[] =>
      value !== null && typeof value === "object" ? Object.values(value).flatMap(leaves) : [value];
    for (const group of Object.values(SITE_WORDS)) for (const word of leaves(group)) expect(typeof word).toBe("string");
    expect(SITE_WORDS.home.layerLine).toContain("{layer}");
    expect(SITE_WORDS.home.readoutLine).toMatch(/\{update\}.*\{strength\}/);
    expect(SITE_WORDS.home.firedLine).toMatch(/\{update\}.*\{wins\}/);
    expect(SITE_WORDS.home.kind).toContain("{rule}");
    expect(SITE_WORDS.stage.readingToward).toContain("{band}");
    expect(SITE_WORDS.stage.readingStrength).toContain("{strength}");
    expect(SITE_WORDS.stage.frameLabel).toContain("{kind}");
    expect(SITE_WORDS.stage.frameGrid).toContain("{side}");
    expect(SITE_WORDS.stage.canvasName).toContain("{title}");
    expect(SITE_WORDS.stage.video).toContain("{seconds}");
    const grow = SITE_WORDS.grow;
    for (const time of [grow.timeBefore, grow.timeLeft, grow.timeTaken]) expect(time).toMatch(/\{updates\}.*\{duration\}/);
    for (const counter of [grow.update, grow.firstFire, grow.fired]) expect(counter).toContain("{update}");
    expect(grow.readerLoading).toMatch(/\{loaded\}.*\{all\}/);
    expect(grow.noAnchor).toContain("Send to Train");
    for (const reading of [grow.reading, grow.readingCentre]) expect(reading).toMatch(/\{group\}.*\{selected\}.*\{patches\}.*\{needed\}/);
    for (const hint of [grow.coSelectedHint, grow.coSelectedHintCentre]) expect(hint).toMatch(/\{patches\}.*\{group\}.*\{needed\}/);
    expect([grow.seconds, grow.minutes]).toEqual([expect.stringContaining("{seconds}"), expect.stringContaining("{minutes}")]);
    expect([grow.choosing, grow.noStrongest, grow.canvasLabel].every((word) => word.includes("{block}"))).toBe(true);
  });
});
