// The training records shared by Home and How: one per published material, from its reference
// picture to the training readouts. engine/tools/prepare_training_demonstration.py writes them
// to app/public/story/. This module validates the records and applies their selection threshold.

import type { AtlasManifest } from "../../library/atlas-cloud";
import { CELLS, PATCH_SLOT_OFFSET, type StrengthBand } from "../../recipe";
import { FIRES } from "../../materials/material-file";
import { STRENGTH_BANDS } from "../look/strength-bands";

/** The prepared story, served from app/public/story/. */
export const STORY_FOLDER = "/story/";
export const STORY_FILE = `${STORY_FOLDER}story.json`;

/** One readout of the training: the grid at the readout tick under the rule after `update` updates. */
export interface TrainingFrame {
  update: number;
  winnerFraction: number;
  /** The median over the patches of |c| / m, as a material's reading. */
  strength: number;
}

export interface StoryRecord {
  /** The published material's id in the gallery index. */
  material: string;
  block: number;
  /** The library patch the rule was trained toward. */
  anchor: {
    imageId: number;
    slot: number;
    band: StrengthBand;
    /** Its place in the block's Atlas plane, in the record's code units (x along the main lobe). */
    atlasPoint: readonly [number, number];
    /** The plane's two axes in code units, the Atlas's origin-preserving principal axes: a code c lands at (c · a1, c · a2). */
    atlasPlane: readonly [readonly [number, number, number], readonly [number, number, number]];
  };
  training: {
    /** The readouts side by side, one square of frameSide pixels each, in app/public/story/. */
    strip: string;
    frameSide: number;
    /** The tick every readout pictures. */
    tick: number;
    /** The run's loss scale m: a reading's strength is in m (provenance; the page shows the strength itself). */
    medianNorm: number;
    /** Every 25 updates (at most 16, evenly spaced), ending with the first fire. */
    frames: TrainingFrame[];
  };
  /** The research run, for provenance. */
  run: string;
}

export interface Story {
  /** The library release the anchors, the Atlas points and the strongest blocks belong to. */
  release: string;
  atlasDomain: AtlasManifest["domain"];
  records: StoryRecord[];
}

function check(condition: boolean, field: string): asserts condition {
  if (!condition) throw new Error(`The recorded trainings have an invalid ${field}`);
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Check the prepared story once at the boundary; the figures then trust its fields. */
export function readStory(value: unknown): Story {
  const story = value as Story & { format?: unknown };
  check(typeof story === "object" && story !== null && story.format === 1, "format");
  check(typeof story.release === "string", "release");
  const domain = story.atlasDomain;
  check(typeof domain === "object" && domain !== null && [domain.xMin, domain.xMax, domain.yMaximum].every(finite) && domain.xMax > domain.xMin, "Index domain");
  check(Array.isArray(story.records) && story.records.length > 0, "record list");
  for (const record of story.records) {
    check(typeof record.material === "string" && Number.isInteger(record.block) && record.block >= 0 && record.block < 16384, "record identity");
    const anchor = record.anchor;
    check(Number.isSafeInteger(anchor?.imageId) && anchor.imageId > 0, "reference patch picture");
    check(Number.isInteger(anchor.slot) && anchor.slot >= PATCH_SLOT_OFFSET && anchor.slot < PATCH_SLOT_OFFSET + CELLS, "reference patch");
    check(STRENGTH_BANDS.includes(anchor.band), "reference patch response level");
    check(Array.isArray(anchor.atlasPoint) && anchor.atlasPoint.length === 2 && anchor.atlasPoint.every(finite), "reference patch point");
    check(Array.isArray(anchor.atlasPlane) && anchor.atlasPlane.length === 2 && anchor.atlasPlane.every((axis: unknown) => Array.isArray(axis) && axis.length === 3 && axis.every(finite)), "reference patch plane");
    const training = record.training;
    check(typeof training?.strip === "string" && /^[a-z0-9-]+\.webp$/.test(training.strip), "training strip");
    check(Number.isInteger(training.frameSide) && training.frameSide > 0 && Number.isInteger(training.tick) && finite(training.medianNorm), "training scale");
    const frames = training.frames;
    check(Array.isArray(frames) && frames.length > 0, "training image frames");
    check(frames.every((frame, index) => Number.isInteger(frame.update) && (index === 0 || frame.update > frames[index - 1]!.update)), "training optimizer updates");
    check(frames.every((frame) => finite(frame.strength) && finite(frame.winnerFraction)), "training measurements");
    check(fires(frames[frames.length - 1]!), "training's last image frame, which must meet the selection target");
  }
  return story;
}

/** A reading fires when the block wins on at least FIRES of the patches (materials/material-file.ts). */
export function fires(frame: TrainingFrame): boolean {
  return frame.winnerFraction >= FIRES;
}
