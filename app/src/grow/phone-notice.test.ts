import { afterEach, describe, expect, test, vi } from "vitest";
import { asksBeforeTraining } from "./phone-notice";

function device({ coarse, width, height, answered }: { coarse: boolean; width: number; height: number; answered: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }));
  vi.stubGlobal("screen", { width, height });
  vi.stubGlobal("sessionStorage", { getItem: () => (answered ? "train" : null), setItem: () => {} });
}

afterEach(() => vi.unstubAllGlobals());

describe("the phone notice before a run", () => {
  test("asks on a phone until the person trains anyway in this tab", () => {
    device({ coarse: true, width: 440, height: 956, answered: false });
    expect(asksBeforeTraining()).toBe(true);
    device({ coarse: true, width: 956, height: 440, answered: false });
    expect(asksBeforeTraining()).toBe(true);
    device({ coarse: true, width: 440, height: 956, answered: true });
    expect(asksBeforeTraining()).toBe(false);
  });

  test("does not ask on a tablet or a computer", () => {
    device({ coarse: true, width: 820, height: 1180, answered: false });
    expect(asksBeforeTraining()).toBe(false);
    device({ coarse: false, width: 1440, height: 900, answered: false });
    expect(asksBeforeTraining()).toBe(false);
  });
});
