import { describe, expect, it } from "vitest";
import { ROWS_READING_AT_ONCE, rowsToRead } from "./picture-levels";

const order = [9168, 12177, 7727, 15672, 7125, 4413, 13007, 16359];
const none = new Set<number>();

describe("rowsToRead", () => {
  it("reads only rows in view, in the page's order, a few at a time", () => {
    const inView = new Set([7125, 9168, 4413, 12177, 13007, 7727, 15672]);
    const reading = rowsToRead(order, inView, none, false);
    expect([...reading]).toEqual([9168, 12177, 7727, 15672]);
    expect(reading.size).toBe(ROWS_READING_AT_ONCE);
  });

  it("never reads a row out of view, however few rows are reading", () => {
    expect([...rowsToRead(order, new Set([16359]), none, false)]).toEqual([16359]);
    expect(rowsToRead(order, none, none, false).size).toBe(0);
  });

  it("gives a settled row's place to the next row in view", () => {
    const inView = new Set(order.slice(0, 6));
    const settled = new Set([9168, 7727]);
    expect([...rowsToRead(order, inView, settled, false)]).toEqual([12177, 15672, 7125, 4413]);
  });

  it("reads nothing while the page is paused: a navigation or the basis group's panel", () => {
    expect(rowsToRead(order, new Set(order), none, true).size).toBe(0);
  });

  it("reads nothing once every row in view has settled", () => {
    const inView = new Set(order.slice(0, 3));
    expect(rowsToRead(order, inView, inView, false).size).toBe(0);
  });
});
