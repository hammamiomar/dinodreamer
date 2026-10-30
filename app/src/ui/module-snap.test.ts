import { expect, test } from "vitest";
import { lastModuleTop, toModule } from "./module-snap";

test("an edge moves down to the next multiple of 64, and an edge on one stays", () => {
  expect(toModule(587.21875)).toBeCloseTo(52.78125, 9);
  expect(toModule(640)).toBe(0);
  expect(toModule(639.8)).toBe(0);
  expect(toModule(1)).toBe(63);
  expect(toModule(100, 16)).toBe(12);
});

test("on a short page the footer starts on the last multiple of 64 that keeps it in the window", () => {
  expect(lastModuleTop(900, 32)).toBe(832);
  expect(lastModuleTop(844, 64)).toBe(768);
  expect(lastModuleTop(896, 32)).toBe(832);
  expect(lastModuleTop(40, 64)).toBe(0);
});
