import { describe, expect, test } from "vitest";
import { easeOutCubic, frameAt, HomeWheelGesture, layerAt, levelsArrived, NARROW_PANEL_SHARE, pageTarget, pageTops, readingLine, sectionAt } from "./home-scroll";

// Five sections on a 900 px window, one window each, with 200 px of footer after them.
const sections = [0, 900, 1800, 2700, 3600].map((top) => ({ top, height: 900 }));

describe("the reading line", () => {
  test("is the middle of the window, or of the part under the panel on a narrow one", () => {
    expect(readingLine(900, 0)).toBe(450);
    expect(readingLine(844, NARROW_PANEL_SHARE)).toBeCloseTo(675.2, 6);
  });
});

describe("the section the window is on", () => {
  test("is the one whose top the reading line has passed", () => {
    expect(sectionAt(sections, 0, 450)).toBe(0);
    expect(sectionAt(sections, 449, 450)).toBe(0);
    expect(sectionAt(sections, 450, 450)).toBe(1);
    expect(sectionAt(sections, 2700 - 450, 450)).toBe(3);
    expect(sectionAt(sections, 9000, 450)).toBe(4);
  });
});

describe("the pages a gesture turns between", () => {
  test("are the sections' tops and the page's end, when the end lies past the last top", () => {
    expect(pageTops(sections, 3800)).toEqual([0, 900, 1800, 2700, 3600, 3800]);
    expect(pageTops(sections, 3600)).toEqual([0, 900, 1800, 2700, 3600]);
  });

  test("land each section under the panel on a narrow window", () => {
    // The panel takes 506 px at the top; the entrance starts under it, and no page lies above the start.
    const narrow = [506, 844, 1688, 2532, 3376].map((top) => ({ top, height: 844 }));
    expect(pageTops(narrow, 3440, 506)).toEqual([0, 338, 1182, 2026, 2870, 3440]);
  });

  test("a manual position advances to the first stop in that direction without skipping or reversing", () => {
    const pages = pageTops(sections, 3800);
    expect(pageTarget(pages, 0, -1)).toBe(0);
    expect(pageTarget(pages, 460, 1)).toBe(900);
    expect(pageTarget(pages, 440, -1)).toBe(0);
    expect(pageTarget(pages, 900, 1)).toBe(1800);
    expect(pageTarget(pages, 3750, 1)).toBe(3800);
    expect(pageTarget(pages, 3800, 1)).toBe(3800);
  });

  test("reading stops expose long text under the mobile panel, with overlap and bounded endpoints", () => {
    const long = [{ top: 800, height: 1000, contentBottom: 1600 }, { top: 1800, height: 800 }];
    expect(pageTops(long, 1300, 480, 800)).toEqual([0, 320, 560, 800, 1300]);
    expect(pageTops(sections, 1000)).toEqual([0, 900, 1000]);
    expect(pageTops(sections, -100)).toEqual([0]);
  });

  test("two pixels of overflow do not add a separate reading stop", () => {
    const slightOverflow = [{ top: 800, height: 800, contentBottom: 1122 }];
    expect(pageTops(slightOverflow, 1600, 480, 800)).toEqual([0, 320, 1600]);
  });

  test("overflow by most of the reading area adds one useful stop", () => {
    const substantialOverflow = [{ top: 800, height: 800, contentBottom: 1360 }];
    expect(pageTops(substantialOverflow, 1600, 480, 800)).toEqual([0, 320, 560, 1600]);
  });

  test("a long section does not end with a two-pixel reading step", () => {
    const long = [{ top: 800, height: 800, contentBottom: 1378 }];
    expect(pageTops(long, 1600, 480, 800)).toEqual([0, 320, 449, 578, 1600]);
  });

  test("a continuous wheel tail cannot start another turn after the animation finishes", () => {
    const gesture = new HomeWheelGesture();
    expect(gesture.direction(100, 0)).toBe(1);
    for (let time = 16; time < 2000; time += 16) expect(gesture.direction(1, time)).toBeNull();
    expect(gesture.direction(-100, 2200)).toBe(-1);
  });

  test("small wheel input accumulates within one gesture, and resets after idle", () => {
    const gesture = new HomeWheelGesture();
    expect(gesture.direction(1, 0)).toBeNull();
    expect(gesture.direction(7, 20)).toBe(1);
    expect(gesture.direction(1, 300)).toBeNull();
    expect(gesture.direction(-8, 600)).toBe(-1);
  });

  test("the turn eases out: quick to leave, gentle to arrive", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBe(0.875);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe("what a playing figure shows", () => {
  test("the frame, the layer and the levels step evenly over the play", () => {
    expect(frameAt(0, 16)).toBe(0);
    expect(frameAt(0.5, 16)).toBe(8);
    expect(frameAt(1, 16)).toBe(15);
    expect(frameAt(1.2, 16)).toBe(15);
    expect(layerAt(0)).toBe(1);
    expect(layerAt(0.5)).toBe(7);
    expect(layerAt(1)).toBe(12);
    expect(levelsArrived(0)).toBe(0);
    expect(levelsArrived(0.5)).toBe(3);
    expect(levelsArrived(1)).toBe(5);
  });
});
