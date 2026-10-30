import { appendRows, emptyRows, type BlockCloud, type CloudAxes, type CloudRows, type FullCloudFile, type WholeCloud } from "./block-cloud";
import { LOOK_CLOUDS_PATH } from "./look-cloud";

// ATF2 full clouds: every winning patch occurrence of one block, in
// image-balanced rounds.
// Read the 128-byte header, then one byte range per column for rows
// [first, end). Never read a whole file: the largest has 4,417,109,308 bytes.
//
// Version 3 uses the same layout for a block's strongest rows: at most 1,024
// rows by stored norm, descending, in a small file that is read whole. Its
// field 12 counts the rows in the file; field 76 holds the whole-cloud count.

export const FULL_CLOUDS_PATH = `${LOOK_CLOUDS_PATH}/full`;
export const STRONGEST_CLOUDS_PATH = `${LOOK_CLOUDS_PATH}/strongest`;
export const FULL_CLOUD_HEADER_BYTES = 128;
const ROW_BYTES = 22;
const FULL_VERSION = 2;
const STRONGEST_VERSION = 3;
export const STRONGEST_ROWS = 1024;
const ORDER_SEED = 20261021;
const MAXIMUM_PICTURE_PATCHES = 256;

/** The contract's prefix bound: 65,536 rows are 1,441,792 row-data bytes in seven ranges. */
export const FULL_CLOUD_PREFIX_ROWS = 65_536;
/**
 * Two prefixes. The page draws, projects and depth-sorts every loaded row on each
 * turn of the view. In Chrome without the GPU one redraw took 82 ms at 65,536
 * rows, 166 ms at 131,072 and 316 ms at 262,144.
 */
export const LOADED_ROWS_LIMIT = 2 * FULL_CLOUD_PREFIX_ROWS;

/** Each column's bytes per row, and its start: 128 + startPerRow × R for a file that stores R rows. */
export const FULL_CLOUD_COLUMNS = {
  codes: { rowBytes: 6, startPerRow: 0 },
  norms: { rowBytes: 2, startPerRow: 6 },
  imageIds: { rowBytes: 8, startPerRow: 8 },
  slots: { rowBytes: 2, startPerRow: 16 },
  ranks: { rowBytes: 1, startPerRow: 18 },
  publicPreview: { rowBytes: 1, startPerRow: 19 },
  gates: { rowBytes: 2, startPerRow: 20 },
} as const;
export type FullCloudColumn = keyof typeof FULL_CLOUD_COLUMNS;
const COLUMN_NAMES = Object.keys(FULL_CLOUD_COLUMNS) as FullCloudColumn[];

export interface FullCloudHeader extends WholeCloud {
  version: 2 | 3;
  /** Rows stored in this file: the whole count N in version 2, min(1,024, N) in version 3. */
  fileRows: number;
  pictures: number;
  maximumPicturePatches: number;
}

export interface ByteRange {
  start: number;
  length: number;
}

/** A reason to stop reading the full file, in plain words for the page. */
export class FullCloudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FullCloudError";
  }
}

export function fullCloudBytes(rows: number): number {
  return FULL_CLOUD_HEADER_BYTES + ROW_BYTES * rows;
}

/**
 * The bytes of one column for rows [first, end). Keep this in Number arithmetic:
 * offsets pass 4 GiB, where 32-bit bitwise operations would wrap.
 */
export function columnRange(column: FullCloudColumn, rows: number, first: number, end: number): ByteRange {
  const { rowBytes, startPerRow } = FULL_CLOUD_COLUMNS[column];
  return {
    start: FULL_CLOUD_HEADER_BYTES + startPerRow * rows + first * rowBytes,
    length: (end - first) * rowBytes,
  };
}

/** The end of the next prefix after `count` loaded rows. */
export function nextPrefixEnd(count: number, rows: number): number {
  return Math.min(count + FULL_CLOUD_PREFIX_ROWS, rows, LOADED_ROWS_LIMIT);
}

export function decodeFullCloudHeader(buffer: ArrayBuffer): FullCloudHeader {
  const view = new DataView(buffer);
  const check = (condition: boolean, field: string) => {
    if (!condition) throw new FullCloudError(`The file header has an invalid ${field}.`);
  };
  check(buffer.byteLength === FULL_CLOUD_HEADER_BYTES, "length");
  check(String.fromCharCode(...new Uint8Array(buffer, 0, 4)) === "ATF2", "signature");
  const version = view.getUint16(4, true);
  check((version === FULL_VERSION || version === STRONGEST_VERSION) && view.getUint16(6, true) === FULL_CLOUD_HEADER_BYTES, "version");
  const block = view.getUint32(8, true);
  const fileRows = view.getUint32(12, true);
  // Counts at 16 and 24 are whole-cloud counts in both versions.
  const rows = version === FULL_VERSION ? fileRows : view.getUint32(76, true);
  const publicRows = view.getUint32(16, true);
  const pictures = view.getUint32(24, true);
  const maximumPicturePatches = view.getUint32(28, true);
  const gateMedian = view.getFloat32(32, true);
  const maximumNorm = view.getFloat32(36, true);
  const axes = [0, 1, 2].map((axis) => [0, 1, 2].map((part) => view.getFloat32(40 + 12 * axis + 4 * part, true))) as unknown as CloudAxes;
  check(block < 16384, "block");
  check(rows > 0 && publicRows <= rows, "row count");
  check(view.getUint32(20, true) === ORDER_SEED, "seed");
  check(pictures > 0 && pictures <= rows, "picture count");
  check(maximumPicturePatches > 0 && maximumPicturePatches <= Math.min(rows, MAXIMUM_PICTURE_PATCHES), "patch count");
  check(Number.isFinite(gateMedian) && gateMedian >= 0 && Number.isFinite(maximumNorm) && maximumNorm > 0, "strength");
  if (version === FULL_VERSION) check(view.getUint32(76, true) === 0, "reserved field");
  else check(fileRows === Math.min(STRONGEST_ROWS, rows), "strongest row count");
  // Float32 axes: orthonormal to about 1e-7, so 1e-5 rejects a misread, not rounding.
  for (const [a, b] of [[0, 0], [1, 1], [2, 2], [0, 1], [0, 2], [1, 2]]) {
    const dot = axes[a][0] * axes[b][0] + axes[a][1] * axes[b][1] + axes[a][2] * axes[b][2];
    check(Math.abs(dot - (a === b ? 1 : 0)) < 1e-5, "frame");
  }
  return { version: version as 2 | 3, block, rows, fileRows, publicRows, pictures, maximumPicturePatches, gateMedian, maximumNorm, axes };
}

/** IEEE binary16 bits to a Number. Subnormals have no implicit leading one. */
export function float16(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

type Float16ArrayConstructor = new (buffer: ArrayBuffer) => ArrayLike<number>;
/** Use the browser's Float16Array when available; older browsers use the scalar decoder. */
const NATIVE_FLOAT16 = (globalThis as { Float16Array?: Float16ArrayConstructor }).Float16Array ?? null;
/** The file is little-endian; a typed array reads it in place only on a little-endian platform. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * A little-endian binary16 column as Numbers: read in place by Float16Array where
 * the platform has it, else by the scalar converter. Both give the same values for
 * all 65,536 patterns (full-cloud.test.ts); the native read is about five times faster.
 */
export function float16Column(body: ArrayBuffer, native: Float16ArrayConstructor | null = NATIVE_FLOAT16): ArrayLike<number> {
  if (native && LITTLE_ENDIAN) return new native(body);
  const view = new DataView(body);
  // Every binary16 value is exact in binary32.
  const values = new Float32Array(body.byteLength / 2);
  for (let index = 0; index < values.length; index++) values[index] = float16(view.getUint16(2 * index, true));
  return values;
}

/**
 * Float16 keeps 11 significant bits. Rounding to nearest moves a normal value x
 * by at most |x| × 2⁻¹¹, and a subnormal one by at most 2⁻²⁵. Use this bound to
 * compare a stored value with the FP32 value it was rounded from.
 */
export function float16Tolerance(value: number): number {
  return Math.max(Math.abs(value) * 2 ** -11, 2 ** -25);
}

/**
 * Stored code ĉ and norm n̂ round the same FP32 code c independently. Each moves
 * at most 2⁻¹¹‖c‖ (normal range), so |‖ĉ‖ − n̂| ≤ 2⁻¹⁰‖c‖. The factor 1.01 covers
 * ‖c‖ ≤ n̂ / (1 − 2⁻¹¹) and the producer's FP32 norm; 2⁻²² covers subnormal parts.
 */
export function storedNormAgrees(code: readonly number[], norm: number): boolean {
  return Math.abs(Math.hypot(code[0], code[1], code[2]) - norm) <= 2 ** -10 * 1.01 * norm + 2 ** -22;
}

/** Rows [0, count) from the seven column bodies of one prefix. Validated once, here. */
export function decodeFullCloudRows(bodies: Readonly<Record<FullCloudColumn, ArrayBuffer>>, count: number): CloudRows {
  const views = Object.fromEntries(COLUMN_NAMES.map((column) => {
    if (bodies[column].byteLength !== count * FULL_CLOUD_COLUMNS[column].rowBytes) throw new FullCloudError(`The ${column} column has the wrong length.`);
    return [column, new DataView(bodies[column])];
  })) as Record<FullCloudColumn, DataView>;
  const codes = float16Column(bodies.codes);
  const norms = float16Column(bodies.norms);
  const gates = float16Column(bodies.gates);
  const rows = emptyRows(count);
  for (let index = 0; index < count; index++) {
    const code = [codes[3 * index], codes[3 * index + 1], codes[3 * index + 2]];
    const norm = norms[index];
    const low = views.imageIds.getUint32(8 * index, true);
    const high = views.imageIds.getUint32(8 * index + 4, true);
    // Image IDs have at most 53 bits, so high × 2³² + low is exact.
    const imageId = high * 2 ** 32 + low;
    const slot = views.slots.getUint16(2 * index, true);
    const rank = views.ranks.getUint8(index);
    const publicPreview = views.publicPreview.getUint8(index);
    const gate = gates[index];
    if (!code.every(Number.isFinite) || !Number.isFinite(norm) || !storedNormAgrees(code, norm)) {
      throw new FullCloudError(`Row ${index} has a response magnitude that does not match its response vector.`);
    }
    if (high >= 2 ** 21 || imageId < 1 || slot < 5 || slot > 260 || rank < 1 || rank > 32 || publicPreview > 1 || !(gate >= 0 && gate < Infinity)) {
      throw new FullCloudError(`Row ${index} has an invalid source identity, rank or selection threshold.`);
    }
    rows.codes.set(code, 3 * index);
    rows.norms[index] = norm;
    rows.imageIds[index] = imageId;
    rows.slots[index] = slot;
    rows.ranks[index] = rank;
    rows.publicPreview[index] = publicPreview;
    rows.gates[index] = gate;
  }
  return rows;
}

/**
 * Why a range response cannot be used, or null. Decided from the status and
 * headers, before the body is read: a 200 answer carries the whole file.
 * Content-Range is checked only when the browser can read it.
 */
export function rangeResponseProblem(response: Response, range: ByteRange, expected: { etag: string | null; fileBytes: number | null }): string | null {
  if (response.status === 200) return "The host sent the whole file instead of the requested part.";
  if (response.status !== 206) return `The host answered ${response.status}.`;
  const etag = response.headers.get("ETag");
  if (expected.etag !== null && etag !== null && etag !== expected.etag) return "The file changed while it was being read.";
  const contentRange = response.headers.get("Content-Range");
  if (contentRange !== null) {
    const [, start, last, total] = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange.trim()) ?? [];
    const sameRange = Number(start) === range.start && Number(last) === range.start + range.length - 1;
    const sameFile = expected.fileBytes === null || total === "*" || Number(total) === expected.fileBytes;
    if (!sameRange || !sameFile) return "The host sent a different part of the file.";
  }
  return null;
}

interface RangeBody {
  body: ArrayBuffer;
  etag: string | null;
  /** The full length from Content-Range, when the browser can read it. */
  fileBytes: number | null;
}

async function readRange(fetcher: typeof fetch, url: string, range: ByteRange, expected: { etag: string | null; fileBytes: number | null }): Promise<RangeBody> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Range: `bytes=${range.start}-${range.start + range.length - 1}` } });
  } catch {
    throw new FullCloudError("The full response set could not be reached.");
  }
  const problem = rangeResponseProblem(response, range, expected);
  if (problem) {
    // Stop a whole-file answer now; the largest would be 4.4 GB.
    await response.body?.cancel().catch(() => undefined);
    throw new FullCloudError(problem);
  }
  const body = await response.arrayBuffer();
  if (body.byteLength !== range.length) throw new FullCloudError(`The host sent ${body.byteLength} bytes instead of ${range.length}.`);
  const total = /\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "")?.[1];
  return { body, etag: response.headers.get("ETag"), fileBytes: total === undefined ? null : Number(total) };
}

/** The header, read by one 128-byte range. Its ETag identifies the file for every later range. */
export async function openFullCloud(fetcher: typeof fetch, url: string, block: number): Promise<{ header: FullCloudHeader; file: FullCloudFile }> {
  const read = await readRange(fetcher, url, { start: 0, length: FULL_CLOUD_HEADER_BYTES }, { etag: null, fileBytes: null });
  const header = decodeFullCloudHeader(read.body);
  if (header.version !== FULL_VERSION) throw new FullCloudError(`The file has version ${header.version}, not a full response set.`);
  if (header.block !== block) throw new FullCloudError(`The file describes basis group ${header.block}.`);
  if (read.fileBytes !== null && read.fileBytes !== fullCloudBytes(header.rows)) throw new FullCloudError("The file length does not match its header.");
  return { header, file: { url, etag: read.etag, rows: header.rows } };
}

/** Rows [first, end): seven concurrent ranges, one per column. */
export async function readFullCloudRows(fetcher: typeof fetch, file: FullCloudFile, first: number, end: number): Promise<CloudRows> {
  const expected = { etag: file.etag, fileBytes: fullCloudBytes(file.rows) };
  const bodies = await Promise.all(COLUMN_NAMES.map(async (column) => {
    const read = await readRange(fetcher, file.url, columnRange(column, file.rows, first, end), expected);
    return [column, read.body] as const;
  }));
  return decodeFullCloudRows(Object.fromEntries(bodies) as Record<FullCloudColumn, ArrayBuffer>, end - first);
}

/**
 * A block's strongest rows: one version-3 file of at most 22,656 bytes, read
 * whole by one GET and edge-cached. Rows are by stored norm, descending.
 * Null when the host has no file for the block.
 */
export async function readStrongestRows(fetcher: typeof fetch, url: string, block: number): Promise<{ header: FullCloudHeader; rows: CloudRows } | null> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new FullCloudError("The strongest rows could not be reached.");
  }
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new FullCloudError(`The host answered ${response.status}.`);
  const file = await response.arrayBuffer();
  const header = decodeFullCloudHeader(file.slice(0, FULL_CLOUD_HEADER_BYTES));
  if (header.version !== STRONGEST_VERSION) throw new FullCloudError(`The file has version ${header.version}, not strongest rows.`);
  if (header.block !== block) throw new FullCloudError(`The file describes basis group ${header.block}.`);
  if (file.byteLength !== fullCloudBytes(header.fileRows)) throw new FullCloudError("The file length does not match its header.");
  const bodies = Object.fromEntries(COLUMN_NAMES.map((column) => {
    const { start, length } = columnRange(column, header.fileRows, 0, header.fileRows);
    return [column, file.slice(start, start + length)];
  })) as Record<FullCloudColumn, ArrayBuffer>;
  const rows = decodeFullCloudRows(bodies, header.fileRows);
  for (let index = 1; index < rows.count; index++) {
    if (rows.norms[index] > rows.norms[index - 1]) throw new FullCloudError("The strongest rows are not in descending order.");
  }
  return { header, rows };
}

/** The full source after its loaded rows. Loading continues to the file's end or the page's limit. */
export function fullBlockCloud(whole: WholeCloud, file: FullCloudFile, rows: CloudRows, sample: CloudRows): BlockCloud {
  return {
    source: "full",
    whole,
    rows,
    sample,
    strongest: null,
    canLoadMore: canLoadMoreRows(rows.count, file),
    notice: null,
    file,
  };
}

function canLoadMoreRows(count: number, file: FullCloudFile): boolean {
  return count < Math.min(file.rows, LOADED_ROWS_LIMIT);
}

/** The next prefix appended; loaded rows keep their indices. */
export async function loadNextPrefix(fetcher: typeof fetch, cloud: BlockCloud, file: FullCloudFile): Promise<BlockCloud> {
  const first = cloud.rows.count;
  const more = await readFullCloudRows(fetcher, file, first, nextPrefixEnd(first, file.rows));
  const rows = appendRows(cloud.rows, more);
  return { ...cloud, rows, canLoadMore: canLoadMoreRows(rows.count, file) };
}
