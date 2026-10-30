import type { Code } from "../recipe";
import type { LookCloud, LookPoint } from "./look-cloud";

// The block page reads a cloud through this one interface. Two sources fill its
// rows: the full ATF2 file in bounded prefixes (full-cloud.ts), or the 4,096-row
// public sample when the full file cannot be read by ranges. Whole-cloud values
// never come from the loaded rows of a full file. The sample always comes along:
// an image-balanced prefix under-represents strong patches, so band counts and
// picture strips use the uniform sample.

/** Three orthonormal axes; display coordinate j is dot(code, axes[j]). */
export type CloudAxes = readonly [Code, Code, Code];

export interface WholeCloud {
  block: number;
  /** All winning patch occurrences of the block. */
  rows: number;
  publicRows: number;
  /** Distinct pictures; the public sample does not record it. */
  pictures: number | null;
  gateMedian: number;
  maximumNorm: number;
  axes: CloudAxes;
}

/** Typed columns for rows [0, count). Loading more rows never renumbers loaded rows. */
export interface CloudRows {
  count: number;
  /** count × 3 native codes, xyz interleaved. */
  codes: Float32Array;
  norms: Float32Array;
  /** Exact integers, at most 53 bits. */
  imageIds: Float64Array;
  slots: Uint16Array;
  ranks: Uint8Array;
  /** 1 when the picture has a public preview. Draw a 0 row; never request its picture. */
  publicPreview: Uint8Array;
  gates: Float32Array;
}

/** The open full file that loading more rows continues. Its fields belong to full-cloud.ts. */
export interface FullCloudFile {
  url: string;
  etag: string | null;
  rows: number;
}

export interface BlockCloud {
  source: "full" | "sample";
  whole: WholeCloud;
  rows: CloudRows;
  /** The uniform 4,096-row public sample, for band shares and strips. The same object as rows for the sample source. */
  sample: CloudRows;
  /** At most 1,024 rows by stored norm, descending, from clouds/strongest/. Null when absent or unreadable. */
  strongest: CloudRows | null;
  canLoadMore: boolean;
  /** Plain words for the page, e.g. why the sample is shown or why loading stopped. */
  notice: string | null;
  /** Null for the sample. */
  file: FullCloudFile | null;
}

/** One row as a point object, made only where the UI or a material request needs it. */
export function cloudPoint(rows: CloudRows, index: number): LookPoint {
  return {
    source: "library",
    code: [rows.codes[3 * index], rows.codes[3 * index + 1], rows.codes[3 * index + 2]],
    norm: rows.norms[index],
    imageId: rows.imageIds[index],
    slot: rows.slots[index],
    publicPreview: rows.publicPreview[index] === 1,
    winnerRank: rows.ranks[index],
    gate: rows.gates[index],
  };
}

export function emptyRows(count: number): CloudRows {
  return {
    count,
    codes: new Float32Array(3 * count),
    norms: new Float32Array(count),
    imageIds: new Float64Array(count),
    slots: new Uint16Array(count),
    ranks: new Uint8Array(count),
    publicPreview: new Uint8Array(count),
    gates: new Float32Array(count),
  };
}

/** Rows [0, a) then [a, a + b): the loaded rows keep their indices. */
export function appendRows(loaded: CloudRows, more: CloudRows): CloudRows {
  const rows = emptyRows(loaded.count + more.count);
  for (const column of ["codes", "norms", "imageIds", "slots", "ranks", "publicPreview", "gates"] as const) {
    rows[column].set(loaded[column]);
    rows[column].set(more[column], column === "codes" ? 3 * loaded.count : loaded.count);
  }
  return rows;
}

/**
 * The fallback fits its frame and maximum to the public sample while keeping
 * the whole block's row count.
 */
export function sampleBlockCloud(cloud: LookCloud, notice: string | null): BlockCloud {
  const { fixture, summary } = cloud;
  const rows = sampleRows(cloud);
  return {
    source: "sample",
    whole: {
      block: fixture.block,
      rows: fixture.population,
      publicRows: Math.round(fixture.population * fixture.publicFraction),
      pictures: null,
      gateMedian: summary.gateMedian,
      maximumNorm: Math.max(...fixture.points.map((point) => point.norm)),
      axes: principalFrame(fixture.points.map((point) => point.code), summary.mainDirection),
    },
    rows,
    sample: rows,
    strongest: null,
    canLoadMore: false,
    notice,
    file: null,
  };
}

/** A strongest-rows file as read: its rows and whole-cloud count, a problem, or null when absent. */
export type StrongestRead = { rows: CloudRows; wholeRows: number } | { problem: string } | null;

/**
 * Either source carries the strongest rows. An absent file leaves them null
 * silently. An unreadable file, or one that counts another whole cloud, leaves
 * them null and adds a notice line; the page still works without them.
 */
export function withStrongestRows(cloud: BlockCloud, read: StrongestRead): BlockCloud {
  if (read === null) return cloud;
  let problem: string;
  if ("problem" in read) problem = read.problem;
  else if (read.wholeRows !== cloud.whole.rows) problem = `The file counts ${read.wholeRows.toLocaleString("en")} patches, not ${cloud.whole.rows.toLocaleString("en")}.`;
  else return { ...cloud, strongest: read.rows };
  return { ...cloud, notice: withNoticeLine(cloud.notice, `The strongest patches could not be read: ${problem}`) };
}

export function withNoticeLine(notice: string | null, line: string): string {
  return notice ? `${notice} ${line}` : line;
}

/**
 * A view's cloud once the first prefix of its full file is read (library.ts blockCloud): that read
 * when it holds rows of the same file, which come after the sample and the strongest rows, so
 * nothing shown is renumbered; else the cloud as it was, with the reason the rows did not come.
 */
export function withFirstPrefix(initial: BlockCloud, read: BlockCloud): BlockCloud {
  const sameFile = read.file !== null && initial.file !== null && read.file.url === initial.file.url && read.file.etag === initial.file.etag;
  if (read.source === "full" && sameFile && read.rows.count >= initial.rows.count) return read;
  return { ...initial, canLoadMore: false, notice: read.notice ?? initial.notice };
}

/** The sample's points as typed columns, in the sample's order. */
export function sampleRows(cloud: LookCloud): CloudRows {
  const points = cloud.fixture.points;
  const rows = emptyRows(points.length);
  points.forEach((point, index) => {
    rows.codes.set(point.code, 3 * index);
    rows.norms[index] = point.norm;
    rows.imageIds[index] = point.imageId;
    rows.slots[index] = point.slot;
    rows.ranks[index] = point.winnerRank;
    rows.publicPreview[index] = point.publicPreview ? 1 : 0;
    rows.gates[index] = point.gate;
  });
  return rows;
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Eigenvectors of E[code codeᵀ], with no centring or whitening. Thus the origin
 * remains zero strength and an orthogonal change of frame preserves all norms.
 * Jacobi rotations diagonalize this symmetric 3 × 3 matrix. The main lobe
 * fixes PC1's sign; deterministic signs and a cross product fix the other two.
 * A full file stores the same frame, fitted to every row, in its header.
 */
export function principalFrame(codes: readonly (readonly number[])[], mainDirection: readonly number[]): CloudAxes {
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const code of codes) {
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) matrix[row][column] += code[row] * code[column] / Math.max(1, codes.length);
    }
  }
  for (let sweep = 0; sweep < 32; sweep++) {
    let p = 0;
    let q = 1;
    for (const [row, column] of [[0, 2], [1, 2]]) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[p][q])) [p, q] = [row, column];
    }
    if (Math.abs(matrix[p][q]) < 1e-12 * Math.max(1, matrix[0][0] + matrix[1][1] + matrix[2][2])) break;
    const angle = 0.5 * Math.atan2(2 * matrix[p][q], matrix[q][q] - matrix[p][p]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const pp = matrix[p][p];
    const qq = matrix[q][q];
    const pq = matrix[p][q];
    for (let axis = 0; axis < 3; axis++) {
      if (axis !== p && axis !== q) {
        const ap = matrix[axis][p];
        const aq = matrix[axis][q];
        matrix[axis][p] = matrix[p][axis] = c * ap - s * aq;
        matrix[axis][q] = matrix[q][axis] = s * ap + c * aq;
      }
      const vp = vectors[axis][p];
      const vq = vectors[axis][q];
      vectors[axis][p] = c * vp - s * vq;
      vectors[axis][q] = s * vp + c * vq;
    }
    matrix[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    matrix[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    matrix[p][q] = matrix[q][p] = 0;
  }
  const order = [0, 1, 2].sort((a, b) => matrix[b][b] - matrix[a][a]);
  const axes = order.map((column): Code => [vectors[0][column], vectors[1][column], vectors[2][column]]);
  if (dot(axes[0], mainDirection) < 0) axes[0] = axes[0].map((v) => -v) as Code;
  const largest = [0, 1, 2].sort((a, b) => Math.abs(axes[1][b]) - Math.abs(axes[1][a]))[0];
  if (axes[1][largest] < 0) axes[1] = axes[1].map((v) => -v) as Code;
  const [a, b] = axes;
  return [a, b, [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]];
}
