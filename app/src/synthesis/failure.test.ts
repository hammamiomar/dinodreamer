import { expect, test } from "vitest";
import { endsSession } from "./failure";

test("any failure before the model is loaded ends the session", () => {
  // Engine strings are fatal during loading, before a usable model exists.
  expect(endsSession("Encoder layer 3: unexpected tensor shape", false)).toBe(true);
  expect(endsSession(new TypeError("Failed to fetch"), false)).toBe(true);
});

test("after the load, an engine string costs only its command", () => {
  expect(endsSession("Optimization produced non-finite values.", true)).toBe(false);
  expect(endsSession(new WebAssembly.RuntimeError("unreachable"), true)).toBe(true);
});
