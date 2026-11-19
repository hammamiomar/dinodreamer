import { useEffect, useState } from "react";
import type { Vec3 } from "../../ui/code-space/projection";

// The density graph and path search run in a worker to keep the page responsive:
// a 65,536-code graph can take about 300 ms and each search about 30 ms.
// The worker uses the same graph and distance functions as the selection tests.

export type RegionGraphCommand =
  | { type: "build"; codes: ArrayBuffer }
  | { type: "distances"; id: number; seeds: readonly number[] };
export type RegionGraphEvent = { type: "distances"; id: number; distances: ArrayBuffer };

/** One worker that holds one graph. It answers in the order it is asked, so a search asked after a build uses that build. */
export class RegionGraph {
  private worker = new Worker(new URL("./region-graph.worker.ts", import.meta.url), { type: "module" });
  private serial = 0;
  private stopped = false;
  private pending = new Map<number, (distances: Float64Array | null) => void>();

  constructor() {
    this.worker.onerror = () => this.dispose();
    this.worker.onmessageerror = () => this.dispose();
    this.worker.onmessage = ({ data }: MessageEvent<RegionGraphEvent>) => {
      this.pending.get(data.id)?.(new Float64Array(data.distances));
      this.pending.delete(data.id);
    };
  }

  /** The graph over these codes, the page's first rows; it replaces the previous one. */
  build(codes: readonly Vec3[]): void {
    if (this.stopped) return;
    const xyz = new Float64Array(codes.length * 3);
    codes.forEach((code, index) => xyz.set(code, 3 * index));
    this.post({ type: "build", codes: xyz.buffer }, [xyz.buffer]);
  }

  /** Path lengths from the nearest seed, or null if the worker failed or was disposed. */
  distances(seeds: readonly number[]): Promise<Float64Array | null> {
    if (this.stopped) return Promise.resolve(null);
    const id = ++this.serial;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: "distances", id, seeds: [...seeds] });
    });
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }

  private post(command: RegionGraphCommand, transfer: Transferable[] = []) {
    try {
      this.worker.postMessage(command, transfer);
    } catch {
      this.dispose();
    }
  }
}

/**
 * The wand's distances for these seeds, or null while they are computed or when there
 * are no seeds. The graph covers the first `rows` codes and is rebuilt only when that
 * count changes: loading rows past it does not rebuild it. The worker starts once the wand
 * may be used (`wanted`: Advanced is open) or a first seed is chosen, and stays from then
 * on: a view that never selects never builds the graph.
 */
export function useRegionDistances(codes: readonly Vec3[], rows: number, seeds: readonly number[], wanted: boolean): { distances: Float64Array | null; failed: boolean } {
  const [started, setStarted] = useState(false);
  if (!started && (wanted || seeds.length > 0)) setStarted(true);
  const [graph, setGraph] = useState<RegionGraph | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!started) return;
    try {
      const created = new RegionGraph();
      setGraph(created);
      return () => created.dispose();
    } catch {
      setUnavailable(true);
    }
  }, [started]);
  useEffect(() => graph?.build(codes.slice(0, rows)), [graph, codes, rows]);
  const [result, setResult] = useState<{
    graph: RegionGraph;
    rows: number;
    seeds: readonly number[];
    distances: Float64Array | null;
  } | null>(null);
  useEffect(() => {
    if (!graph || seeds.length === 0) return;
    let current = true;
    void graph.distances(seeds).then((distances) => {
      if (current) setResult({ graph, rows, seeds, distances });
    });
    return () => {
      current = false;
    };
  }, [graph, rows, seeds]);
  const current = result?.graph === graph && result?.rows === rows && result?.seeds === seeds ? result : null;
  return {
    distances: current?.distances ?? null,
    failed: unavailable || (current !== null && current.distances === null),
  };
}
