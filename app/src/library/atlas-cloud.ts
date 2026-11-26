import { LOOK_CLOUDS_PATH } from "./look-cloud";

// Prepared by engine/tools/prepare_atlas.py beside the response-set samples. Objects in the
// library are immutable, so each record format has its own folder: atlas-clouds holds the ATC2
// records of the releases before this one, and stays.
export const ATLAS_CLOUDS_PATH = LOOK_CLOUDS_PATH.replace(
  /\/clouds$/,
  "/atlas-clouds-3d",
);
/**
 * Format ATC3. The ATC2 header's 60 bytes, then the flat view's two axes in native coordinates
 * (6 float32), the flat view's point count (uint16) and two reserved bytes.
 */
export const ATLAS_RECORD_HEADER_BYTES = 88;
/** One point: the native code as three float16, then its response level. */
const POINT_BYTES = 7;
const PICTURE_BYTES = 11;
/** The flat view draws at most this many points: the first ones of a record. */
export const ATLAS_FLAT_POINT_LIMIT = 512;
/** A record holds at most this many points; the rotating view draws them all. */
export const ATLAS_NATIVE_POINT_LIMIT = 1024;
/** Four picture addresses per band, or every patch of a band with fewer. */
export const ATLAS_PICTURES_PER_BAND = 4;
export type BandCounts = readonly [number, number, number, number];
export type AtlasBand = 0 | 1 | 2 | 3;

export interface AtlasIndexEntry {
  block: number;
  total: number;
  reach: number;
  nearRing: number;
  pole: number;
  counts: BandCounts;
}

/** A patch's three coordinates along its basis group's own directions. */
export type NativeCode = readonly [number, number, number];

export interface AtlasCloud extends AtlasIndexEntry {
  ring: number;
  maximum: number;
  cuts: readonly [number, number, number];
  wins: number;
  publicShare: number;
  /**
   * Every stored patch in native coordinates, at most 1,024, for a view in three dimensions.
   * The first `points.length` of them are the flat view's patches, in the same order.
   */
  nativePoints: ReadonlyArray<{ code: NativeCode; band: AtlasBand }>;
  /**
   * The two axes of the flat view's plane, in native coordinates. They come from the whole
   * sample of 4,096 patches, not from the stored points.
   */
  planeAxes: readonly [NativeCode, NativeCode];
  /** The flat view: at most 512 patches in the plane, x = code · planeAxes[0], y = code · planeAxes[1]. */
  points: ReadonlyArray<{ x: number; y: number; band: AtlasBand }>;
  pictures: ReadonlyArray<{ imageId: number; slot: number; band: AtlasBand }>;
}

export interface AtlasManifest {
  release: string;
  blocks: number;
  domain: { xMin: number; xMax: number; yMaximum: number };
  materials: ReadonlyArray<{ block: number; modes: Array<"fill" | "plant"> }>;
}

export interface CloudAtlas {
  manifest: AtlasManifest;
  entries: AtlasIndexEntry[];
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Index data: ${message}`);
}

function number(value: unknown, minimum = 0): number {
  check(
    typeof value === "number" && Number.isFinite(value) && value >= minimum,
    "number",
  );
  return value;
}

function object(value: unknown): Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "record",
  );
  return value as Record<string, unknown>;
}

export function decodeAtlasManifest(value: unknown): AtlasManifest {
  const file = object(value);
  const domain = object(file.domain);
  check(
    file.format === 1 &&
      file.source === LOOK_CLOUDS_PATH &&
      typeof file.release === "string",
    "source",
  );
  const blocks = number(file.blocks, 1);
  check(Number.isInteger(blocks) && blocks <= 16384, "basis group count");
  const xMin = number(domain.xMin, -65504);
  const xMax = number(domain.xMax, 0);
  const yMaximum = number(domain.yMaximum, 0.001);
  check(xMax > xMin, "drawing domain");
  const materials = file.materials ?? [];
  check(Array.isArray(materials), "materials");
  return {
    release: file.release as string,
    blocks,
    domain: { xMin, xMax, yMaximum },
    materials: materials.map((value) => {
      const material = object(value);
      const block = number(material.block);
      check(
        Number.isInteger(block) &&
          block < 16384 &&
          Array.isArray(material.modes),
        "automaton identity",
      );
      check(
        material.modes.every((mode) => mode === "fill" || mode === "plant"),
        "automaton modes",
      );
      return { block, modes: material.modes as Array<"fill" | "plant"> };
    }),
  };
}

function signature(view: DataView, text: string): boolean {
  return [...text].every(
    (letter, index) => view.getUint8(index) === letter.charCodeAt(0),
  );
}

function countsAt(view: DataView, offset: number, total: number): BandCounts {
  const counts = [0, 1, 2, 3].map((index) =>
    view.getUint16(offset + index * 2, true),
  ) as unknown as BandCounts;
  check(
    counts.reduce((sum, count) => sum + count, 0) === total && total <= 4096,
    "patch counts",
  );
  return counts;
}

function floatAt(view: DataView, offset: number, upper = Infinity): number {
  const value = number(view.getFloat32(offset, true));
  check(value <= upper, "range");
  return value;
}

export function decodeAtlasIndex(buffer: ArrayBuffer): AtlasIndexEntry[] {
  check(buffer.byteLength >= 8, "index header");
  const view = new DataView(buffer);
  const size = view.getUint16(4, true);
  check(
    signature(view, "ATI1") &&
      size <= 16384 &&
      view.getUint16(6, true) === 24 &&
      buffer.byteLength === 8 + size * 24,
    "index size",
  );
  const entries: AtlasIndexEntry[] = [];
  for (let index = 0; index < size; index++) {
    const offset = 8 + index * 24;
    const block = view.getUint16(offset, true);
    const total = view.getUint16(offset + 2, true);
    check(
      block < 16384 && (index === 0 || block > entries[index - 1].block),
      "basis group order",
    );
    entries.push({
      block,
      total,
      reach: floatAt(view, offset + 4),
      nearRing: floatAt(view, offset + 8, 1),
      pole: floatAt(view, offset + 12, 1),
      counts: countsAt(view, offset + 16, total),
    });
  }
  return entries;
}

/** Float16 decoding also works in browsers that do not yet provide getFloat16. */
function halfAt(view: DataView, offset: number): number {
  const bits = view.getUint16(offset, true);
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31;
  const mantissa = bits & 1023;
  check(exponent !== 31, "finite point");
  return (
    sign *
    (exponent === 0
      ? mantissa * 2 ** -24
      : (1 + mantissa / 1024) * 2 ** (exponent - 15))
  );
}

function axisAt(view: DataView, offset: number): NativeCode {
  const axis = [0, 4, 8].map((step) => view.getFloat32(offset + step, true));
  check(axis.every(Number.isFinite), "plane axis");
  return axis as unknown as NativeCode;
}

function dot(code: NativeCode, axis: NativeCode): number {
  return code[0] * axis[0] + code[1] * axis[1] + code[2] * axis[2];
}

/** Float16 belongs to the Index cards only. Look and Studio still use the full native codes. */
export function decodeAtlasCloud(buffer: ArrayBuffer): AtlasCloud {
  check(buffer.byteLength >= ATLAS_RECORD_HEADER_BYTES, "response set header");
  const view = new DataView(buffer);
  const block = view.getUint16(4, true);
  const total = view.getUint16(6, true);
  const pointCount = view.getUint16(8, true);
  const pictureCount = view.getUint8(10);
  const flatPointCount = view.getUint16(84, true);
  check(
    signature(view, "ATC3") &&
      block < 16384 &&
      pointCount <= ATLAS_NATIVE_POINT_LIMIT &&
      flatPointCount <= Math.min(pointCount, ATLAS_FLAT_POINT_LIMIT) &&
      pictureCount <= 4 * ATLAS_PICTURES_PER_BAND,
    "response set size",
  );
  check(
    buffer.byteLength ===
      ATLAS_RECORD_HEADER_BYTES +
        pointCount * POINT_BYTES +
        pictureCount * PICTURE_BYTES,
    "response set length",
  );
  check(
    pointCount <= total &&
      pictureCount <= total &&
      (total === 0 || flatPointCount > 0),
    "sample size",
  );
  const counts = countsAt(view, 20, total);
  const ring = floatAt(view, 12);
  const maximum = floatAt(view, 16);
  const cuts = [
    floatAt(view, 48),
    floatAt(view, 52),
    floatAt(view, 56),
  ] as const;
  check(
    cuts[0] >= ring &&
      cuts[1] >= cuts[0] &&
      cuts[2] >= cuts[1] &&
      cuts[2] <= Math.max(maximum, ring),
    "response level cuts",
  );
  const planeAxes = [axisAt(view, 60), axisAt(view, 72)] as const;
  let offset = ATLAS_RECORD_HEADER_BYTES;
  const nativePoints: AtlasCloud["nativePoints"][number][] = [];
  const points: AtlasCloud["points"][number][] = [];
  for (let index = 0; index < pointCount; index++, offset += POINT_BYTES) {
    const band = view.getUint8(offset + 6);
    check(band < 4 && counts[band] > 0, "point response level");
    const code: NativeCode = [
      halfAt(view, offset),
      halfAt(view, offset + 2),
      halfAt(view, offset + 4),
    ];
    nativePoints.push({ code, band: band as AtlasBand });
    if (index < flatPointCount) {
      points.push({
        x: dot(code, planeAxes[0]),
        y: dot(code, planeAxes[1]),
        band: band as AtlasBand,
      });
    }
  }
  const pictures: AtlasCloud["pictures"][number][] = [];
  for (let index = 0; index < pictureCount; index++, offset += PICTURE_BYTES) {
    const imageId = Number(view.getBigUint64(offset, true));
    const slot = view.getUint16(offset + 8, true);
    const band = view.getUint8(offset + 10);
    check(
      Number.isSafeInteger(imageId) &&
        imageId > 0 &&
        slot >= 5 &&
        slot <= 260 &&
        band < 4 &&
        counts[band] > 0,
      "picture record",
    );
    pictures.push({ imageId, slot, band: band as AtlasBand });
  }
  check(
    counts.every(
      (count, band) =>
        pictures.filter((picture) => picture.band === band).length ===
        Math.min(count, ATLAS_PICTURES_PER_BAND),
    ),
    "pictures per response level",
  );
  return {
    block,
    total,
    ring,
    maximum,
    cuts,
    counts,
    nativePoints,
    planeAxes,
    points,
    pictures,
    wins: view.getUint32(28, true),
    publicShare: floatAt(view, 32, 1),
    reach: floatAt(view, 36),
    nearRing: floatAt(view, 40, 1),
    pole: floatAt(view, 44, 1),
  };
}
