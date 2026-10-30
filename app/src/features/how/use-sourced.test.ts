import { describe, expect, test } from "vitest";
import type { HowSource } from "./how-source";
import { sourcedFor, type SourcedAnswer } from "./use-sourced";

// These tests exercise the display boundary. They need source identity, not a model or network.
const firstSource = { kind: "recorded" } as HowSource;
const secondSource = { kind: "recorded" } as HowSource;

describe("the source answer visible to a figure", () => {
  const answer: SourcedAnswer<Float32Array> = {
    source: firstSource,
    inputs: [11],
    result: { status: "ready", value: Float32Array.of(0.25, 0.75) },
  };

  test("an answer remains ready for the same source and equal dependency values", () => {
    expect(sourcedFor(answer, firstSource, [11])).toBe(answer.result);
  });

  test("a changed picture hides the old answer before the next effect runs", () => {
    expect(sourcedFor(answer, secondSource, [11])).toEqual({ status: "loading" });
  });

  test("a changed layer or patch hides an older answer from the same source", () => {
    expect(sourcedFor(answer, firstSource, [10])).toEqual({ status: "loading" });
    expect(sourcedFor(answer, firstSource, [11, 54])).toEqual({ status: "loading" });
    expect(sourcedFor(answer, firstSource, [])).toEqual({ status: "loading" });
  });

  test("removing a source is immediately idle, including while an old answer is retained", () => {
    expect(sourcedFor(answer, null, [11])).toEqual({ status: "idle" });
    expect(sourcedFor(null, firstSource, [11])).toEqual({ status: "loading" });
  });

  test("a previous picture's failure is not attributed to a new picture", () => {
    const failed: SourcedAnswer<never> = {
      source: firstSource,
      inputs: [],
      result: { status: "failed", message: "The recorded file could not be read." },
    };
    expect(sourcedFor(failed, firstSource, [])).toBe(failed.result);
    expect(sourcedFor(failed, secondSource, [])).toEqual({ status: "loading" });
  });

  test("dependency comparison follows React's identity semantics", () => {
    const region = { patch: 54 };
    const selected: SourcedAnswer<string> = {
      source: firstSource,
      inputs: [region],
      result: { status: "ready", value: "selected region" },
    };
    expect(sourcedFor(selected, firstSource, [region])).toBe(selected.result);
    expect(sourcedFor(selected, firstSource, [{ patch: 54 }])).toEqual({ status: "loading" });
  });
});
