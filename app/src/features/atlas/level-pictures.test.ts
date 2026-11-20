import { describe, expect, it } from "vitest";
import type { AtlasBand } from "../../library/atlas-cloud";
import { levelReadingOrder } from "./level-pictures";

const picture = (imageId: number, band: AtlasBand) => ({ imageId, slot: 5 + imageId, band });
// A record's pictures in record order: up to four per level, levels interleaved.
const record = [
  picture(1, 0), picture(2, 1), picture(3, 3), picture(4, 0), picture(5, 2),
  picture(6, 3), picture(7, 1), picture(8, 2), picture(9, 3), picture(10, 0),
];

describe("levelReadingOrder", () => {
  it("reads the strongest level first and keeps record order within a level", () => {
    expect(levelReadingOrder(record, 4).map((item) => item.imageId)).toEqual([3, 6, 9, 5, 8, 2, 7, 1, 4, 10]);
  });

  it("takes each level's first pictures in record order when a view shows fewer", () => {
    expect(levelReadingOrder(record, 1).map((item) => item.imageId)).toEqual([3, 5, 2, 1]);
    expect(levelReadingOrder(record, 2).map((item) => item.imageId)).toEqual([3, 6, 5, 8, 2, 7, 1, 4]);
  });

  it("skips a level without pictures", () => {
    const withoutLevel2 = record.filter((item) => item.band !== 2);
    expect(levelReadingOrder(withoutLevel2, 1).map((item) => item.band)).toEqual([3, 1, 0]);
  });

  it("leaves the record as it was", () => {
    const copy = record.map((item) => ({ ...item }));
    levelReadingOrder(record, 1);
    expect(record).toEqual(copy);
  });
});
