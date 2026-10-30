import type { Vec3 } from "../../ui/code-space/projection";
import { FULL_CLOUD_PREFIX_ROWS } from "../../library/full-cloud";

export const REGION_SELECTION_DEFAULTS = { neighbours: 12, gapFactor: 2.5, radiusFraction: 0.18 } as const;
/**
 * The graph holds at most the first 65,536 codes it is given, one full-cloud
 * prefix, so its cost stays bounded as more rows load. Later rows are drawn and
 * lasso-selectable; the wand does not reach them.
 */
export const REGION_GRAPH_ROWS = FULL_CLOUD_PREFIX_ROWS;
interface Edge { node: number; length: number }
export interface DensityGraph {
  edges: Edge[][];
  /** -1 for a point outside the graph. */
  nodeForPoint: number[];
  maximumEdge: number;
}

/**
 * Mutual nearest neighbours follow the sampled lobe. A global gap cap keeps
 * isolated lobes apart: 2.5 × the median kth-neighbour distance. This is a
 * selection heuristic on the loaded rows, not a learned material mode. Build
 * once per cloud. A k-d tree finds the same neighbours as an all-pairs search,
 * in O(N log N) expected time and O(Nk) memory. Exact duplicate codes share a
 * node, so all occurrences remain selectable. The graph holds the first
 * `graphRows` codes (REGION_GRAPH_ROWS; tests pass a small bound).
 */
export function buildDensityGraph(
  codes: readonly Vec3[],
  settings: { neighbours: number; gapFactor: number } = REGION_SELECTION_DEFAULTS,
  graphRows = REGION_GRAPH_ROWS,
): DensityGraph {
  const unique: Vec3[] = [];
  const byCode = new Map<string, number>();
  const nodeForPoint = codes.map((code, index) => {
    if (index >= graphRows) return -1;
    const key = code.join(",");
    const known = byCode.get(key);
    if (known !== undefined) return known;
    const node = unique.length;
    byCode.set(key, node);
    unique.push(code);
    return node;
  });
  const count = unique.length;
  const k = Math.min(settings.neighbours, count - 1);
  if (k <= 0) return { edges: Array.from({ length: count }, () => []), nodeForPoint, maximumEdge: 0 };
  const { found, squared } = nearestNeighbours(Float64Array.from(unique.flat()), k);
  const localScales = Float64Array.from({ length: count }, (_, node) => Math.sqrt(squared[node * k + k - 1])).sort();
  const median = (localScales[Math.floor((count - 1) / 2)] + localScales[Math.floor(count / 2)]) / 2;
  const maximumEdge = median * settings.gapFactor;
  const edges: Edge[][] = Array.from({ length: count }, () => []);
  for (let from = 0; from < count; from++) {
    for (let rank = 0; rank < k; rank++) {
      const node = found[from * k + rank];
      if (squared[from * k + rank] > maximumEdge ** 2) continue;
      let mutual = false;
      for (let back = node * k; back < node * k + k && !mutual; back++) mutual = found[back] === from;
      if (mutual) edges[from].push({ node, length: Math.sqrt(squared[from * k + rank]) });
    }
  }
  return { edges, nodeForPoint, maximumEdge };
}

/** Leaves of at most eight nodes; below that, splitting costs more than scanning. */
const LEAF_NODES = 8;

/**
 * Each node's k nearest nodes, ordered by squared distance, then node index:
 * the order an all-pairs search gives. Row n of found and squared is
 * [n·k, n·k + k). Coordinates are xyz, node-major.
 * A k-d tree splits the nodes at the median of their widest axis. A search skips
 * a subtree only when the gap to its splitting plane alone exceeds the current
 * kth distance; a subtree at exactly that distance is still searched, so ties
 * are ordered by node index as in the all-pairs search.
 */
function nearestNeighbours(xyz: Float64Array, k: number): { found: Int32Array; squared: Float64Array } {
  const count = xyz.length / 3;
  const tree = buildTree(xyz);
  const found = new Int32Array(count * k);
  const squared = new Float64Array(count * k).fill(Infinity);
  let row = 0;
  let size = 0;
  let from = 0;
  let qx = 0;
  let qy = 0;
  let qz = 0;

  function offer(node: number) {
    const distance = (qx - xyz[3 * node]) ** 2 + (qy - xyz[3 * node + 1]) ** 2 + (qz - xyz[3 * node + 2]) ** 2;
    const last = row + k - 1;
    if (size === k && (distance > squared[last] || (distance === squared[last] && node > found[last]))) return;
    let at = size === k ? last : row + size++;
    while (at > row && (squared[at - 1] > distance || (squared[at - 1] === distance && found[at - 1] > node))) {
      squared[at] = squared[at - 1];
      found[at] = found[at - 1];
      at--;
    }
    squared[at] = distance;
    found[at] = node;
  }

  function search(branch: number) {
    const axis = tree.axis[branch];
    if (axis < 0) {
      for (let at = tree.start[branch]; at < tree.end[branch]; at++) {
        if (tree.order[at] !== from) offer(tree.order[at]);
      }
      return;
    }
    const gap = (axis === 0 ? qx : axis === 1 ? qy : qz) - tree.split[branch];
    search(gap < 0 ? tree.lower[branch] : tree.upper[branch]);
    if (size < k || gap * gap <= squared[row + k - 1]) search(gap < 0 ? tree.upper[branch] : tree.lower[branch]);
  }

  for (from = 0; from < count; from++) {
    row = from * k;
    size = 0;
    qx = xyz[3 * from];
    qy = xyz[3 * from + 1];
    qz = xyz[3 * from + 2];
    search(0);
  }
  return { found, squared };
}

/**
 * Branch b covers order[start[b] .. end[b]). A leaf has axis −1. Otherwise its
 * lower branch holds coordinates ≤ split and its upper branch ≥ split on `axis`.
 */
function buildTree(xyz: Float64Array) {
  const count = xyz.length / 3;
  const capacity = 4 * Math.ceil(count / LEAF_NODES) + 1;
  const tree = {
    order: Int32Array.from({ length: count }, (_, index) => index),
    start: new Int32Array(capacity),
    end: new Int32Array(capacity),
    axis: new Int8Array(capacity),
    split: new Float64Array(capacity),
    lower: new Int32Array(capacity),
    upper: new Int32Array(capacity),
  };
  let branches = 0;
  function build(start: number, end: number): number {
    const branch = branches++;
    tree.start[branch] = start;
    tree.end[branch] = end;
    tree.axis[branch] = -1;
    if (end - start <= LEAF_NODES) return branch;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let at = start; at < end; at++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = xyz[3 * tree.order[at] + axis];
        if (value < low[axis]) low[axis] = value;
        if (value > high[axis]) high[axis] = value;
      }
    }
    const axis = [0, 1, 2].reduce((widest, candidate) => high[candidate] - low[candidate] > high[widest] - low[widest] ? candidate : widest, 0);
    const middle = (start + end) >> 1;
    selectNth(tree.order, xyz, axis, start, end - 1, middle);
    tree.axis[branch] = axis;
    tree.split[branch] = xyz[3 * tree.order[middle] + axis];
    tree.lower[branch] = build(start, middle);
    tree.upper[branch] = build(middle, end);
    return branch;
  }
  build(0, count);
  return tree;
}

/** Hoare quickselect: order[first..last] is partitioned around its nth smallest coordinate on `axis`. */
function selectNth(order: Int32Array, xyz: Float64Array, axis: number, first: number, last: number, nth: number) {
  const at = (index: number) => xyz[3 * order[index] + axis];
  while (first < last) {
    const pivot = at((first + last) >> 1);
    let left = first;
    let right = last;
    while (left <= right) {
      while (at(left) < pivot) left++;
      while (at(right) > pivot) right--;
      if (left <= right) {
        const swap = order[left];
        order[left++] = order[right];
        order[right--] = swap;
      }
    }
    if (nth <= right) last = right;
    else if (nth >= left) first = left;
    else return;
  }
}

/**
 * Multi-source shortest paths in code units. Reuse when only the radius dial
 * changes. A seed outside the graph has distance zero and reaches nothing else.
 */
export function regionDistances(graph: DensityGraph, seeds: readonly number[]): Float64Array {
  const count = graph.edges.length;
  const distances = new Float64Array(count).fill(Infinity);
  const settled = new Uint8Array(count);
  const queue = new NodeQueue();
  const outside = new Set<number>();
  for (const seed of seeds) {
    const node = graph.nodeForPoint[seed];
    if (node === undefined) continue;
    if (node < 0) outside.add(seed);
    else {
      distances[node] = 0;
      queue.push(node, 0);
    }
  }
  // Dijkstra's method; a node queued again at a shorter distance leaves a stale entry, skipped here.
  while (queue.size > 0) {
    const closest = queue.pop();
    if (settled[closest]) continue;
    settled[closest] = 1;
    for (const edge of graph.edges[closest]) {
      const distance = distances[closest] + edge.length;
      if (distance < distances[edge.node]) {
        distances[edge.node] = distance;
        queue.push(edge.node, distance);
      }
    }
  }
  return Float64Array.from(graph.nodeForPoint, (node, point) => {
    if (node >= 0) return distances[node];
    return outside.has(point) ? 0 : Infinity;
  });
}

/** A binary min-heap of nodes keyed by distance. */
class NodeQueue {
  private readonly nodes: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number) {
    let at = this.nodes.length;
    this.nodes.push(node);
    this.keys.push(key);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.nodes[at] = this.nodes[parent];
      this.keys[at] = this.keys[parent];
      at = parent;
    }
    this.nodes[at] = node;
    this.keys[at] = key;
  }

  pop(): number {
    const top = this.nodes[0];
    const node = this.nodes.pop()!;
    const key = this.keys.pop()!;
    const size = this.nodes.length;
    if (size > 0) {
      let at = 0;
      while (true) {
        let child = 2 * at + 1;
        if (child >= size) break;
        if (child + 1 < size && this.keys[child + 1] < this.keys[child]) child++;
        if (this.keys[child] >= key) break;
        this.nodes[at] = this.nodes[child];
        this.keys[at] = this.keys[child];
        at = child;
      }
      this.nodes[at] = node;
      this.keys[at] = key;
    }
    return top;
  }
}

export function withinRegionRadius(distances: Float64Array, radius: number): number[] {
  if (!Number.isFinite(radius) || radius < 0) return [];
  const indices: number[] = [];
  distances.forEach((distance, index) => { if (distance <= radius) indices.push(index); });
  return indices;
}

export interface ProjectedPoint { x: number; y: number }

/** Boundary points are inside. Depth is deliberately absent: a flat lasso is a prism. */
export function insideLasso(point: ProjectedPoint, polygon: readonly ProjectedPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-7 && point.x >= Math.min(a.x, b.x) - 1e-7 && point.x <= Math.max(a.x, b.x) + 1e-7
      && point.y >= Math.min(a.y, b.y) - 1e-7 && point.y <= Math.max(a.y, b.y) + 1e-7) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function lassoHasArea(polygon: readonly ProjectedPoint[]): boolean {
  const a = polygon[0];
  const b = polygon.find((point) => point.x !== a?.x || point.y !== a?.y);
  return !!a && !!b && polygon.some((c) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-7);
}

/** Null is unselected; an empty previous set stays empty under intersection. */
export function intersectLasso(points: readonly ProjectedPoint[], polygon: readonly ProjectedPoint[], previous: readonly number[] | null): readonly number[] | null {
  if (!lassoHasArea(polygon)) return previous;
  const candidates = previous ?? points.map((_, index) => index);
  return candidates.filter((index) => insideLasso(points[index], polygon));
}

/**
 * "picture" is every patch of the person's own picture in this block; "band" is every
 * loaded library patch of one strength band, with the anchor chosen when it was selected.
 */
export type LookSelection =
  | { kind: "none" }
  | { kind: "wand"; seeds: number[] }
  | { kind: "lasso"; indices: readonly number[]; passes: number }
  | { kind: "picture"; indices: readonly number[] }
  | { kind: "band"; band: number; indices: readonly number[]; anchor: number | null };

export function seedRegion(current: LookSelection, index: number, additive: boolean): LookSelection {
  const seeds = additive && current.kind === "wand" ? current.seeds : [];
  return { kind: "wand", seeds: seeds.includes(index) ? seeds : [...seeds, index] };
}

export function applyLasso(current: LookSelection, points: readonly ProjectedPoint[], polygon: readonly ProjectedPoint[], selected: readonly number[] | null): LookSelection {
  const indices = intersectLasso(points, polygon, selected);
  if (indices === selected || indices === null) return current;
  return { kind: "lasso", indices, passes: current.kind === "lasso" ? current.passes + 1 : 1 };
}
