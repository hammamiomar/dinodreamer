import type { Code } from "../recipe";

// Published response-set samples, read through the library client's cache.
export const LOOK_CLOUDS_PATH = "web/v2/readouts/5e2791a38795e8cc07b301307d137224d40d12a318547a038e49003ac29ed139/clouds";

export interface LookPoint {
  source: "library";
  code: Code;
  norm: number;
  imageId: number;
  slot: number;
  publicPreview: boolean;
  winnerRank: number;
  gate: number;
}

export interface LookFixture {
  block: number;
  release: string;
  points: LookPoint[];
  publicFraction: number;
  population: number;
}

export interface LookSummary {
  block: number;
  release: string;
  gateMedian: number;
  /** The median norm of all the block's winning patch codes (radius p50): Grow's loss scale m. */
  medianNorm: number;
  mainDirection: Code;
  patchRows: number;
}

export interface LookCloud {
  fixture: LookFixture;
  summary: LookSummary;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a response set record.");
  return value as Record<string, unknown>;
}

function positive(value: unknown, label: string, zero = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (zero ? value < 0 : value <= 0)) {
    throw new Error(`Invalid response set ${label}.`);
  }
  return value;
}

function integer(value: unknown, label: string, low: number, high = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < low || value > high) throw new Error(`Invalid response set ${label}.`);
  return value;
}

function code(value: unknown): Code {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((part) => typeof part === "number" && Number.isFinite(part))) {
    throw new Error("Invalid response vector in the response set.");
  }
  return [value[0], value[1], value[2]];
}

/** Validate once at the public-file boundary. Keep native codes and exact image IDs. */
export function decodeLookFixture(value: unknown): LookFixture {
  const file = record(value);
  const source = record(file.source);
  const sampling = record(file.sampling);
  if (file.format !== 2 || sampling.filter !== "public_preview" || !Array.isArray(file.rows) || file.rows.length === 0 || file.rows.length > 4096) {
    throw new Error("Unsupported response set sample for Inspect.");
  }
  if (typeof source.release !== "string") throw new Error("The response set has no release.");
  const seen = new Set<string>();
  const points = file.rows.map((value): LookPoint => {
    const row = record(value);
    const point: LookPoint = {
      source: "library",
      code: code(row.code),
      norm: positive(row.norm, "response magnitude"),
      imageId: integer(row.image_id, "image ID", 1),
      slot: integer(row.slot, "patch slot", 5, 260),
      publicPreview: row.public_preview === true,
      winnerRank: integer(row.winner_rank, "selection rank", 1, 32),
      gate: positive(row.gate, "selection threshold", true),
    };
    const key = `${point.imageId}:${point.slot}`;
    if (!point.publicPreview || seen.has(key)) throw new Error("Response set tokens must be unique and have public previews.");
    if (Math.abs(Math.hypot(...point.code) - point.norm) > 1e-4 * Math.max(1, point.norm)) throw new Error("A response magnitude in the response set differs from its response vector.");
    seen.add(key);
    return point;
  });
  const publicFraction = positive(sampling.public_preview_fraction, "public fraction", true);
  if (publicFraction > 1 || sampling.selected_rows !== points.length) throw new Error("Invalid response set sampling counts.");
  return {
    block: integer(file.block, "basis group", 0, 16383),
    release: source.release,
    points,
    publicFraction,
    population: integer(sampling.source_block_rows, "population", points.length),
  };
}

export function decodeLookSummary(value: unknown): LookSummary {
  const file = record(value);
  if (typeof file.release !== "string") throw new Error("The response set summary has no release.");
  const mainDirection = code(record(file.main_lobe).direction);
  if (Math.hypot(...mainDirection) === 0) throw new Error("The main direction must be nonzero.");
  return {
    block: integer(file.block, "basis group", 0, 16383),
    release: file.release,
    gateMedian: positive(file.gate_median, "median selection threshold", true),
    medianNorm: positive(record(file.radius).p50, "median selected response magnitude"),
    mainDirection,
    patchRows: integer(file.patch_rows, "patch rows", 1),
  };
}
