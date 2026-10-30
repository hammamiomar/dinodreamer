import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../ui/code-space/projection";
import {
  applyLasso, buildDensityGraph, insideLasso, intersectLasso, seedRegion, REGION_SELECTION_DEFAULTS, REGION_GRAPH_ROWS, regionDistances, withinRegionRadius,
  type DensityGraph, type LookSelection,
} from "./selection";

const codes: Vec3[] = [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0], [1, 3, 0], [2, 3, 0], [3, 3, 0], [3, 2, 0], [3, 1, 0], [3, 0, 0]];
const graph = buildDensityGraph(codes, { neighbours: 2, gapFactor: 2.5 });
const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];

describe("density-following wand", () => {
  it("measures distance along a curved cloud instead of cutting across its empty interior", () => {
    const distances = regionDistances(graph, [0]);
    expect(withinRegionRadius(distances, 4)).toEqual([0, 1, 2, 3, 4]);
    expect(distances[9]).toBe(9); // This point is only three units away through empty space.
  });

  it("unions shift-added seeds and lets the dial shrink without rebuilding the graph", () => {
    const initial = seedRegion({ kind: "none" }, 0, false);
    const added = seedRegion(initial, 9, true);
    expect(added).toEqual({ kind: "wand", seeds: [0, 9] });
    const distances = regionDistances(graph, added.kind === "wand" ? added.seeds : []);
    expect(withinRegionRadius(distances, 1)).toEqual([0, 1, 8, 9]);
    expect(withinRegionRadius(distances, 0)).toEqual([0, 9]);
    expect(seedRegion(added, 4, false)).toEqual({ kind: "wand", seeds: [4] });
    expect(seedRegion(added, 9, true)).toEqual(added);
  });

  it("does not cross a large empty gap, even at a large reach", () => {
    const points: Vec3[] = [...codes, [100, 0, 0], [100, 1, 0], [100, 2, 0]];
    const disconnected = buildDensityGraph(points, { neighbours: 2, gapFactor: 2.5 });
    expect(withinRegionRadius(regionDistances(disconnected, [0]), 1000)).toEqual(codes.map((_, index) => index));
  });

  it("includes every occurrence at an identical code, and handles an isolated seed", () => {
    const duplicate = buildDensityGraph([[2, 3, 4], [2, 3, 4]]);
    expect(withinRegionRadius(regionDistances(duplicate, [1]), 0)).toEqual([0, 1]);
    const singleton = buildDensityGraph([[2, 3, 4]]);
    expect(withinRegionRadius(regionDistances(singleton, [0]), 0)).toEqual([0]);
    expect(withinRegionRadius(regionDistances(singleton, []), 100)).toEqual([]);
    expect(withinRegionRadius(new Float64Array([0]), -1)).toEqual([]);
  });
});

/**
 * An independent reference using all-pairs neighbour search and linear-scan
 * Dijkstra. The k-d tree and heap must give the same graph, distances and selections.
 */
function allPairsGraph(codes: readonly Vec3[]): DensityGraph {
  const unique: Vec3[] = [];
  const byCode = new Map<string, number>();
  const nodeForPoint = codes.map((code) => {
    const key = code.join(",");
    const known = byCode.get(key);
    if (known !== undefined) return known;
    byCode.set(key, unique.length);
    unique.push(code);
    return unique.length - 1;
  });
  const count = unique.length;
  const k = Math.min(REGION_SELECTION_DEFAULTS.neighbours, count - 1);
  const nearest: { node: number; length: number }[][] = Array.from({ length: count }, () => []);
  function offer(from: number, node: number, squared: number) {
    const row = nearest[from];
    if (row.length === k && row[k - 1].length <= squared) return;
    let at = row.length;
    while (at > 0 && row[at - 1].length > squared) at--;
    row.splice(at, 0, { node, length: squared });
    if (row.length > k) row.pop();
  }
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const squared = (unique[a][0] - unique[b][0]) ** 2 + (unique[a][1] - unique[b][1]) ** 2 + (unique[a][2] - unique[b][2]) ** 2;
      offer(a, b, squared);
      offer(b, a, squared);
    }
  }
  const localScales = nearest.map((row) => Math.sqrt(row[k - 1].length)).sort((a, b) => a - b);
  const median = (localScales[Math.floor((count - 1) / 2)] + localScales[Math.floor(count / 2)]) / 2;
  const maximumEdge = median * REGION_SELECTION_DEFAULTS.gapFactor;
  const edges = nearest.map((row, from) => row
    .filter((edge) => edge.length <= maximumEdge ** 2 && nearest[edge.node].some((other) => other.node === from))
    .map((edge) => ({ node: edge.node, length: Math.sqrt(edge.length) })));
  return { edges, nodeForPoint, maximumEdge };
}

function linearScanDistances(graph: DensityGraph, seeds: readonly number[]): Float64Array {
  const count = graph.edges.length;
  const distances = new Float64Array(count).fill(Infinity);
  const visited = new Uint8Array(count);
  for (const seed of seeds) distances[graph.nodeForPoint[seed]] = 0;
  for (let step = 0; step < count; step++) {
    let closest = -1;
    let distance = Infinity;
    for (let node = 0; node < count; node++) {
      if (!visited[node] && distances[node] < distance) { closest = node; distance = distances[node]; }
    }
    if (closest < 0) break;
    visited[closest] = 1;
    for (const edge of graph.edges[closest]) distances[edge.node] = Math.min(distances[edge.node], distance + edge.length);
  }
  return Float64Array.from(graph.nodeForPoint, (node) => distances[node]);
}

/**
 * About 500 codes where the all-pairs search is cheap: two integer lattices 50 apart
 * (equal neighbour distances, a gap no edge crosses) and 30 repeated codes.
 */
function syntheticCloud(): Vec3[] {
  const lattice = (side: number, offset: number): Vec3[] =>
    Array.from({ length: side ** 3 }, (_, index) => [offset + (index % side), Math.floor(index / side) % side, Math.floor(index / side ** 2)]);
  const near = lattice(7, 0);
  const far = lattice(5, 50);
  const repeated = Array.from({ length: 30 }, (_, index) => near[index * 11]);
  return [...near, ...far, ...repeated];
}

describe("the wand against the recorded all-pairs search", () => {
  it("gives the all-pairs graph, distances and selections with ties, repeated codes and a gap", () => {
    const codes = syntheticCloud();
    const graph = buildDensityGraph(codes);
    const reference = allPairsGraph(codes);
    expect(graph).toEqual(reference);
    for (const seeds of [[0], [342], [343], [100, 400], [470]]) {
      const distances = regionDistances(graph, seeds);
      const recorded = linearScanDistances(reference, seeds);
      expect(distances).toEqual(recorded);
      for (const radius of [0, 1, 1.5, 3, 1000]) {
        expect(withinRegionRadius(distances, radius)).toEqual(withinRegionRadius(recorded, radius));
      }
    }
    // A repeated code selects with its first occurrence; the far lattice stays apart.
    expect(withinRegionRadius(regionDistances(graph, [0]), 0)).toEqual([0, 468]);
    expect(withinRegionRadius(regionDistances(graph, [0]), 1000).some((index) => index >= 343 && index < 468)).toBe(false);
  });

  it("builds over the first rows only; a later seed selects itself", () => {
    const codes = syntheticCloud();
    const graph = buildDensityGraph(codes, REGION_SELECTION_DEFAULTS, 400);
    expect(graph.edges).toHaveLength(400);
    expect(graph.nodeForPoint.slice(400).every((node) => node === -1)).toBe(true);
    const inside = withinRegionRadius(regionDistances(graph, [0]), 1000);
    expect(inside.length).toBeGreaterThan(1);
    expect(Math.max(...inside)).toBeLessThan(400);
    expect(withinRegionRadius(regionDistances(graph, [403]), 1000)).toEqual([403]);
  });

  it("holds one full-cloud prefix by default", () => {
    expect(REGION_GRAPH_ROWS).toBe(65_536);
    // One repeated code keeps the graph to one node, so the default bound costs no neighbour search.
    const graph = buildDensityGraph(Array.from({ length: REGION_GRAPH_ROWS + 1 }, (): Vec3 => [1, 2, 3]));
    expect(graph.nodeForPoint[REGION_GRAPH_ROWS - 1]).toBe(0);
    expect(graph.nodeForPoint[REGION_GRAPH_ROWS]).toBe(-1);
    expect(withinRegionRadius(regionDistances(graph, [REGION_GRAPH_ROWS]), 1000)).toEqual([REGION_GRAPH_ROWS]);
  });
});

describe("lasso intersection", () => {
  it("includes boundary points, independent of drawing direction", () => {
    const polygon = rectangle(0, 0, 2, 2);
    expect(insideLasso({ x: 0, y: 1 }, polygon)).toBe(true);
    expect(insideLasso({ x: 1, y: 1 }, [...polygon].reverse())).toBe(true);
    expect(insideLasso({ x: 3, y: 1 }, polygon)).toBe(false);
  });

  it("selects a full prism in a plane, then trims its depth from a second view", () => {
    const points: Vec3[] = [[0, 0, -3], [0, 0, 3], [2, 2, 0], [0.5, 0.5, 1]];
    const front = points.map(([x, y]) => ({ x, y }));
    const side = points.map(([, y, z]) => ({ x: z, y }));
    const first = intersectLasso(front, rectangle(-1, -1, 1, 1), null);
    expect(first).toEqual([0, 1, 3]);
    const second = intersectLasso(side, rectangle(0, -1, 4, 1), first);
    expect(second).toEqual([1, 3]);
    const reverse = intersectLasso(front, rectangle(-1, -1, 1, 1), intersectLasso(side, rectangle(0, -1, 4, 1), null));
    expect(reverse).toEqual(second);
  });

  it("never reopens an empty intersection; a degenerate gesture preserves the selection", () => {
    const points = [{ x: 1, y: 1 }];
    expect(intersectLasso(points, rectangle(0, 0, 2, 2), [])).toEqual([]);
    const previous = [0];
    expect(intersectLasso(points, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], previous)).toBe(previous);
    expect(intersectLasso(points, [], null)).toBeNull();
  });

  it("trims a wand selection and records subsequent passes", () => {
    const points = codes.map(([x, y]) => ({ x, y }));
    const wand: LookSelection = { kind: "wand", seeds: [0] };
    const first = applyLasso(wand, points, rectangle(-1, 0.5, 1, 2.5), [0, 1, 2, 3]);
    expect(first).toEqual({ kind: "lasso", indices: [1, 2], passes: 1 });
    expect(applyLasso(first, points, rectangle(-1, 1.5, 1, 3), [1, 2])).toEqual({ kind: "lasso", indices: [2], passes: 2 });
    expect(applyLasso(first, points, [], [1, 2])).toBe(first);
  });
});
