// Creation files: what "Export" writes and "Import" reads. The recipe inside an
// imported file is untrusted, so it goes through the structural parser
// (recipe-parse.ts). Import keeps incomplete drafts, so it does not require
// validateRecipe to pass; the editor shows those problems.

import type { Recipe } from "../recipe";
import { parseRecipe, recipeUpgradedFrom, type UpgradedFrom } from "../recipe-parse";

/** The JSON file that "Export" writes and "Import" reads. */
export const CREATION_FILE_FORMAT = "dinodreamer-creation";

export interface CreationFile {
  format: typeof CREATION_FILE_FORMAT;
  version: 1;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The recipe as stored; the importer parses it (an unreadable record's export carries it as it was). */
  recipe: unknown;
  /** The creation's image, as a data: URL, so one file restores the whole creation. */
  previewPng: string;
  /** Present when the image was made by an earlier objective (storage/creations.ts). */
  upgradedFrom?: UpgradedFrom;
  /** The engine build that made the image (storage/creations.ts); legacy files may omit it. */
  engine?: string;
  /** The updates the image had (storage/creations.ts); legacy files may omit it. */
  step?: number;
  /** The image is the placeholder saved before the first frame. */
  placeholder?: true;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path}: expected an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path}: expected a string`);
  return value;
}

export async function encodeCreationFile(creation: {
  title: string;
  createdAt: string;
  updatedAt: string;
  recipe: unknown;
  previewPng: Blob;
  upgradedFrom?: UpgradedFrom;
  engine?: string;
  step?: number;
  placeholder?: true;
}): Promise<string> {
  const file: CreationFile = {
    format: CREATION_FILE_FORMAT,
    version: 1,
    title: creation.title,
    createdAt: creation.createdAt,
    updatedAt: creation.updatedAt,
    recipe: creation.recipe,
    previewPng: await pngDataUrl(creation.previewPng),
    ...(creation.upgradedFrom ? { upgradedFrom: creation.upgradedFrom } : {}),
    ...(creation.engine ? { engine: creation.engine } : {}),
    ...(creation.step !== undefined ? { step: creation.step } : {}),
    ...(creation.placeholder ? { placeholder: creation.placeholder } : {}),
  };
  return JSON.stringify(file);
}

/**
 * The title, recipe and image of an exported creation, `upgradedFrom` when its image
 * was made by an earlier objective (the file says so, or its recipe as written says so:
 * recipe-parse.ts recipeUpgradedFrom), and the engine build that made the image when
 * the file names one. Throws with the first problem found.
 */
export function decodeCreationFile(text: string): {
  title: string;
  recipe: Recipe;
  previewPng: Blob;
  upgradedFrom?: UpgradedFrom;
  engine?: string;
  step?: number;
  placeholder?: true;
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The file is not JSON.");
  }
  const file = object(value, "file");
  if (file.format !== CREATION_FILE_FORMAT || file.version !== 1) throw new Error("The file is not a saved DinoDreamer image.");
  const fileRecipe = object(file.recipe, "file.recipe");
  const marked = file.upgradedFrom === 1 || file.upgradedFrom === 2 || file.upgradedFrom === 3 ? file.upgradedFrom : undefined;
  const upgradedFrom = marked ?? recipeUpgradedFrom(fileRecipe);
  const engine = file.engine === undefined ? undefined : string(file.engine, "file.engine");
  const step = file.step === undefined ? undefined : updateCount(file.step, "file.step");
  const placeholder = file.placeholder === true ? (true as const) : undefined;
  return {
    title: string(file.title, "file.title"),
    recipe: parseRecipe(fileRecipe),
    previewPng: pngBlob(string(file.previewPng, "file.previewPng")),
    ...(upgradedFrom ? { upgradedFrom } : {}),
    ...(engine ? { engine } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
}

function updateCount(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path}: expected a non-negative integer`);
  return value as number;
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

async function pngDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // btoa takes a binary string; build it in chunks to stay under argument limits.
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return PNG_DATA_URL_PREFIX + btoa(binary);
}

function pngBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) throw new Error("file.previewPng: expected a PNG data URL");
  const binary = atob(dataUrl.slice(PNG_DATA_URL_PREFIX.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "image/png" });
}
