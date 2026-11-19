import { afterEach, expect, it, vi } from "vitest";
import { RegionGraph, type RegionGraphEvent } from "./region-graph";

class GraphWorker {
  onmessage: ((event: MessageEvent<RegionGraphEvent>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

function graphWorker() {
  const worker = new GraphWorker();
  vi.stubGlobal("Worker", class { constructor() { return worker; } });
  return { worker, graph: new RegionGraph() };
}

afterEach(() => vi.unstubAllGlobals());

it("resolves a search from its worker response", async () => {
  const { worker, graph } = graphWorker();
  const pending = graph.distances([2]);
  worker.onmessage!({ data: { type: "distances", id: 1, distances: new Float64Array([3, 2, 0]).buffer } } as MessageEvent<RegionGraphEvent>);
  expect(await pending).toEqual(new Float64Array([3, 2, 0]));
  graph.dispose();
});

it.each(["onerror", "onmessageerror", "dispose"] as const)("settles pending searches after %s and refuses later work", async (failure) => {
  const { worker, graph } = graphWorker();
  const resolved = vi.fn();
  void graph.distances([0]).then(resolved);
  if (failure === "dispose") graph.dispose();
  else worker[failure]?.();
  await Promise.resolve();
  expect(resolved).toHaveBeenCalledExactlyOnceWith(null);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(await graph.distances([1])).toBeNull();
  graph.buildPrefix([[0, 0, 0]], 1);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
});

it("settles a search when posting to the worker throws", async () => {
  const { worker, graph } = graphWorker();
  worker.postMessage.mockImplementation(() => { throw new Error("Worker unavailable"); });
  expect(await graph.distances([0])).toBeNull();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("only transfers a new graph when its bounded prefix grows", () => {
  const { worker, graph } = graphWorker();
  const codes = [[1, 2, 3], [4, 5, 6], [7, 8, 9]] as const;
  graph.buildPrefix(codes.slice(0, 1), 1);
  graph.buildPrefix(codes.slice(0, 2), 2);
  graph.buildPrefix([...codes], 2);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  const [command] = worker.postMessage.mock.calls[1]!;
  expect([...new Float64Array(command.codes)]).toEqual([1, 2, 3, 4, 5, 6]);
});
