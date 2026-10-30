// The featurizer learning, as one patch saw it: the hibiscus patch read through the checkpoint
// at the end of each training pass (engine/tools/prepare_how_featurizer_passes.py). For
// each pass, the 32 groups the patch selected, their response magnitudes, the remainder as those
// groups are added back, and the pass's mean training loss.
import { fill, SITE_WORDS } from "../../app/site-words";
import { BLOCKS, WINNERS } from "./how-shapes";

const WORDS = SITE_WORDS.how;
const RECORD = "/how/training/featurizer-passes.json";

export interface FeaturizerPass {
  pass: number;
  checkpoint: string;
  sha256: string;
  /** The optimizer updates completed by the end of this pass. */
  updates: number;
  /** Mean training-batch losses over the pass. */
  loss: { main: number; auxiliary: number; total: number };
  gain: number;
  /** The patch's 32 selected groups in rank order, and their response magnitudes. */
  groups: number[];
  norms: number[];
  /** The remainder, ‖x − x̂‖ / ‖x‖, with 0 … 32 of the groups added back: 33 values from 1. */
  curve: number[];
}

export interface FeaturizerPassesRecord {
  provenance: Record<string, string>;
  imageId: number;
  /** Token slot, including the five prefix tokens; subtract PREFIX to obtain a patch index. */
  slot: number;
  block: number;
  passes: FeaturizerPass[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label} record.`);
  return value as Record<string, unknown>;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${label} value.`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label} text.`);
  return value;
}
function numbers(value: unknown, count: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error(`Invalid ${label} shape.`);
  return value.map((item) => finite(item, label));
}

function pass(value: unknown): FeaturizerPass {
  const data = record(value, "pass");
  const loss = record(data.loss, "pass loss");
  const groups = numbers(data.groups, WINNERS, "pass groups");
  if (groups.some((group) => !Number.isInteger(group) || group < 0 || group >= BLOCKS)) throw new Error("A pass names a group outside the collection.");
  if (new Set(groups).size !== WINNERS) throw new Error("A pass repeats a group.");
  const curve = numbers(data.curve, WINNERS + 1, "pass curve");
  if (curve[0] !== 1 || curve.some((left) => left < 0)) throw new Error("A pass's remainder does not start whole.");
  return {
    pass: finite(data.pass, "pass number"),
    checkpoint: text(data.checkpoint, "pass checkpoint"),
    sha256: text(data.sha256, "pass checksum"),
    updates: finite(data.updates, "pass updates"),
    loss: { main: finite(loss.main, "main loss"), auxiliary: finite(loss.auxiliary, "auxiliary loss"), total: finite(loss.total, "total loss") },
    gain: finite(data.gain, "pass gain"),
    groups,
    norms: numbers(data.norms, WINNERS, "pass norms"),
    curve,
  };
}

export function decodeFeaturizerPasses(value: unknown): FeaturizerPassesRecord {
  const data = record(value, "featurizer passes");
  if (data.format !== 1) throw new Error("Unsupported featurizer passes record format.");
  const provenance = record(data.provenance, "provenance");
  if (!Array.isArray(data.passes) || data.passes.length === 0) throw new Error("The record holds no passes.");
  const passes = data.passes.map(pass);
  if (passes.some((entry, at) => entry.pass !== at + 1)) throw new Error("The passes are not in order from 1.");
  return {
    provenance: Object.fromEntries(Object.entries(provenance).map(([key, entry]) => [key, text(entry, `provenance ${key}`)])),
    imageId: finite(data.imageId, "picture"),
    slot: finite(data.slot, "slot"),
    block: finite(data.block, "block"),
    passes,
  };
}

/** The record, or null where the deployment has none; loader failures carry the site's words. */
export async function loadFeaturizerPasses(): Promise<FeaturizerPassesRecord | null> {
  let response: Response;
  try {
    response = await fetch(RECORD);
  } catch (cause) {
    throw new Error(WORDS.basisTrainingDownloadFailed, { cause });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(fill(WORDS.basisTrainingReadFailed, { status: response.status }));
  if (response.headers.get("content-type")?.includes("text/html")) return null;
  try {
    return decodeFeaturizerPasses(await response.json());
  } catch (cause) {
    throw new Error(WORDS.basisTrainingInvalid, { cause });
  }
}
