// A value a figure asks of How's source (how-source.ts), as React state: idle without a source,
// loading, ready or failed. A newer source or input replaces an older answer that comes late.

import { useEffect, useState } from "react";
import type { HowSource } from "./how-source";

export type Sourced<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "failed"; message: string };

export interface SourcedAnswer<T> {
  source: HowSource;
  inputs: readonly unknown[];
  result: Sourced<T>;
}

/** An answer belongs to its source and numerical inputs, including before an effect runs. */
export function sourcedFor<T>(answer: SourcedAnswer<T> | null, source: HowSource | null, inputs: readonly unknown[]): Sourced<T> {
  if (!source) return { status: "idle" };
  const matches = answer?.source === source
    && answer.inputs.length === inputs.length
    && inputs.every((input, index) => Object.is(input, answer.inputs[index]));
  return matches ? answer.result : { status: "loading" };
}

export function useSourced<T>(source: HowSource | null, ask: (source: HowSource) => Promise<T>, inputs: readonly unknown[] = []): Sourced<T> {
  const [answer, setAnswer] = useState<SourcedAnswer<T> | null>(null);
  useEffect(() => {
    if (!source) {
      setAnswer(null);
      return;
    }
    let current = true;
    const request = { source, inputs };
    setAnswer({ ...request, result: { status: "loading" } });
    Promise.resolve().then(() => ask(source)).then(
      (value) => current && setAnswer({ ...request, result: { status: "ready", value } }),
      (error: unknown) => current && setAnswer({
        ...request,
        result: { status: "failed", message: error instanceof Error ? error.message : String(error) },
      }),
    );
    return () => { current = false; };
    // `ask` is a new closure each render; the source and the caller's inputs decide a new answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, ...inputs]);
  return sourcedFor(answer, source, inputs);
}
