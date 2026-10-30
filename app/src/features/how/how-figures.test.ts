import { describe, expect, it } from "vitest";
import { figureCellAt } from "./how-figures";

describe("pointer selection in a CSS-sized figure", () => {
  const target = (width: number, height = width) => ({
    getBoundingClientRect: () => ({ left: 80, top: 120, width, height }),
  }) as HTMLElement;

  it("selects the same patch before and after resizing and page scaling", () => {
    for (const width of [160, 384, 480, 640]) {
      expect(figureCellAt({
        currentTarget: target(width),
        clientX: 80 + width * 5.5 / 16,
        clientY: 120 + width * 7.5 / 16,
      }, 16)).toBe(7 * 16 + 5);
    }
  });

  it("maps a cell grid by its own dimensions, independent of backing resolution", () => {
    expect(figureCellAt({
      currentTarget: target(192, 128),
      clientX: 80 + 192 * 31.5 / 64,
      clientY: 120 + 128 * 12.5 / 32,
    }, 64, 32)).toBe(12 * 64 + 31);
  });

  it("does not wrap the right or bottom edge into another cell", () => {
    const currentTarget = target(256);
    expect(figureCellAt({ currentTarget, clientX: 336, clientY: 120 }, 16)).toBeNull();
    expect(figureCellAt({ currentTarget, clientX: 80, clientY: 376 }, 16)).toBeNull();
    expect(figureCellAt({ currentTarget, clientX: 79, clientY: 120 }, 16)).toBeNull();
  });
});
