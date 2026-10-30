import { describe, expect, it } from "vitest";
import { anchorOf, arrowBetween, mapLayout, returnPath } from "./how-map";
import { HOW_SECTIONS, HOW_STAGES, type HowStage } from "./how-sections";

const MODEL: HowStage[] = ["picture", "patches", "dino", "tokens"];
const WITH_BASIS: HowStage[] = [...MODEL, "basis", "responses"];
const LOOP: HowStage[] = [...HOW_STAGES];

describe("the map's layout", () => {
  it("places only the present stages, in the map's order, from the left edge", () => {
    const layout = mapLayout(["tokens", "picture", "dino", "patches"], 1);
    expect(layout.boxes.map((box) => box.stage)).toEqual(MODEL);
    expect(layout.boxes[0]!.x).toBe(8);
    for (let at = 1; at < layout.boxes.length; at++) {
      const before = layout.boxes[at - 1]!;
      expect(layout.boxes[at]!.x).toBe(before.x + before.width + 20);
    }
    const last = layout.boxes.at(-1)!;
    expect(layout.width).toBe(last.x + last.width + 8);
  });

  it("is as wide as its stages, so a section with fewer stages is narrower", () => {
    expect(mapLayout(MODEL, 1).width).toBeLessThan(mapLayout(WITH_BASIS, 1).width);
    expect(mapLayout(WITH_BASIS, 1).width).toBeLessThan(mapLayout(LOOP, 1).width);
  });

  it("folds the second half back under the first, right to left", () => {
    const layout = mapLayout(LOOP, 2);
    const at = (stage: HowStage) => layout.boxes.find((box) => box.stage === stage)!;
    expect(layout.boxes.filter((box) => box.row === 0).map((box) => box.stage)).toEqual(["automaton", "picture", "patches", "dino"]);
    expect(at("tokens").x).toBe(at("dino").x);
    expect(at("loss").x).toBe(at("automaton").x);
    expect(at("tokens").y).toBeGreaterThan(at("dino").y);
    expect(at("basis").x).toBeLessThan(at("tokens").x);
  });

  it("fills a folded odd count from the right, so the path turns at the row's end", () => {
    const layout = mapLayout(["picture", "patches", "dino", "tokens", "basis"], 2);
    const at = (stage: HowStage) => layout.boxes.find((box) => box.stage === stage)!;
    expect(at("tokens").row).toBe(1);
    expect(at("tokens").x).toBe(at("dino").x);
    expect(at("basis").x).toBe(at("patches").x);
  });

  it("keeps a lane under the row for the return path only when the loop closes", () => {
    expect(mapLayout(LOOP, 1).height).toBeGreaterThan(mapLayout(WITH_BASIS, 1).height);
    expect(mapLayout(WITH_BASIS, 1).height).toBe(mapLayout(MODEL, 1).height);
  });

  it("fits the CSS arrangement boundaries for the three acts", () => {
    expect(mapLayout(MODEL, 1).width).toBe(452);
    expect(mapLayout(WITH_BASIS, 1).width).toBe(724);
    expect(mapLayout(LOOP, 1).width).toBe(932);
    for (const stages of [MODEL, WITH_BASIS, LOOP]) {
      expect(mapLayout(stages, 2).height).toBe(168);
      expect(mapLayout(stages, 2).width).toBeLessThanOrEqual(500);
    }
  });
});

describe("the arrows", () => {
  it("run along a row and down between the rows", () => {
    const one = mapLayout(MODEL, 1);
    const along = arrowBetween(one.boxes[0]!, one.boxes[1]!);
    expect(along.y1).toBe(along.y2);
    expect(along.x2).toBe(along.x1 + 20);
    const two = mapLayout(LOOP, 2);
    const down = arrowBetween(two.boxes[3]!, two.boxes[4]!);
    expect(down.x1).toBe(down.x2);
    expect(down.y2).toBeGreaterThan(down.y1);
    const back = arrowBetween(two.boxes[4]!, two.boxes[5]!);
    expect(back.x2).toBeLessThan(back.x1);
  });

  it("returns under the one row and straight up between the two", () => {
    const one = mapLayout(LOOP, 1);
    expect(returnPath(one.boxes.at(-1)!, one.boxes[0]!)).toMatch(/^M[\d.]+ [\d.]+ V[\d.]+ H[\d.]+ V[\d.]+$/);
    const two = mapLayout(LOOP, 2);
    expect(returnPath(two.boxes.at(-1)!, two.boxes[0]!)).toMatch(/^M[\d.]+ [\d.]+ V[\d.]+$/);
  });
});

describe("an absent stage", () => {
  it("waits inside the present stage before it, else the one after", () => {
    expect(anchorOf("basis", MODEL)).toBe("tokens");
    expect(anchorOf("loss", WITH_BASIS)).toBe("responses");
    expect(anchorOf("automaton", MODEL)).toBe("picture");
    expect(anchorOf("automaton", [])).toBeNull();
  });

  it("has an anchor in every section of the story", () => {
    for (const section of HOW_SECTIONS) {
      for (const stage of HOW_STAGES) {
        if (!section.map.present.includes(stage)) expect(anchorOf(stage, section.map.present), `${section.id} ${stage}`).not.toBeNull();
      }
    }
  });
});
