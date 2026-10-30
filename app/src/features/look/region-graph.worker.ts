// The wand's graph and path search, off the page's thread (region-graph.ts).
import { buildDensityGraph, regionDistances, type DensityGraph } from "./selection";
import type { RegionGraphCommand, RegionGraphEvent } from "./region-graph";

let graph: DensityGraph = { edges: [], nodeForPoint: [], maximumEdge: 0 };

self.onmessage = ({ data }: MessageEvent<RegionGraphCommand>) => {
  if (data.type === "build") {
    const xyz = new Float64Array(data.codes);
    const codes = Array.from({ length: xyz.length / 3 }, (_, index) => [xyz[3 * index], xyz[3 * index + 1], xyz[3 * index + 2]] as const);
    graph = buildDensityGraph(codes);
    return;
  }
  const distances = regionDistances(graph, data.seeds).buffer as ArrayBuffer;
  const event: RegionGraphEvent = { type: "distances", id: data.id, distances };
  self.postMessage(event, { transfer: [distances] });
};
