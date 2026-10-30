// The gallery Worker's contract, seen from the app.
//
//   GET  /api/gallery      → { entries: GalleryEntry[] }, newest first
//   POST /api/submissions  multipart: image (PNG ≤ 2 MB), recipe (JSON ≤ 64 KB,
//                          passes validateRecipe), title (≤ 80), credit (≤ 40),
//                          turnstileToken (when the form shows the check) → { id }
//
// Published images and recipes are public objects on the library bucket. Their
// URLs may be absolute or relative to ASSET_BASE_URL.

import { validateRecipe } from "../../recipe";
import type { Recipe } from "../../recipe";
import { parseRecipe, recipeUpgradedFrom, type UpgradedFrom } from "../../recipe-parse";
import { UPGRADED_IMAGE_REASON } from "../../storage/creations";
import { GALLERY_TEXT } from "./gallery-text";

export interface GalleryEntry {
  id: string;
  title: string;
  credit: string;
  imageUrl: string;
  /** A 256 px WebP of the image; null for entries without a thumbnail. */
  thumbnailUrl: string | null;
  recipeUrl: string;
  publishedAt: string;
  /** The engine build that made the image, as its submission recorded it; absent when unknown. */
  engine?: string;
}

export interface Submission {
  image: Blob;
  recipe: Recipe;
  title: string;
  credit: string;
  /** The engine build that made the image, as the saved creation records it; blank or absent means unknown. */
  engine?: string;
}

export const SUBMISSION_LIMITS = {
  imageBytes: 2 * 1024 * 1024,
  recipeBytes: 64 * 1024,
  titleCharacters: 80,
  creditCharacters: 40,
} as const;

type Fetch = typeof fetch;

/** `assetBase` is ASSET_BASE_URL as an absolute URL ending in "/"; relative entry URLs resolve against it. */
export async function fetchGallery(assetBase: URL, fetcher: Fetch = fetch): Promise<GalleryEntry[]> {
  const response = await fetcher("/api/gallery");
  if (!response.ok) throw new Error(GALLERY_TEXT.fetch.answered(response.status));
  const index = (await response.json()) as { entries?: unknown };
  if (!Array.isArray(index.entries)) throw new Error(GALLERY_TEXT.fetch.noEntries);
  return index.entries.map((entry, position) => galleryEntry(entry, position, assetBase));
}

/**
 * A published recipe, checked for structure before it reaches the editor, and `upgradedFrom`
 * when the recipe as written says an earlier objective made the entry's image (recipe-parse.ts
 * recipeUpgradedFrom): the parse upgrades the recipe, so only the written one can say so.
 */
export async function fetchGalleryRecipe(entry: GalleryEntry, fetcher: Fetch = fetch): Promise<{ recipe: Recipe; upgradedFrom?: UpgradedFrom }> {
  const response = await fetcher(entry.recipeUrl);
  if (!response.ok) throw new Error(GALLERY_TEXT.fetch.recipeAnswered(entry.title, response.status));
  const written: unknown = await response.json();
  const upgradedFrom = recipeUpgradedFrom(written);
  return { recipe: parseRecipe(written), ...(upgradedFrom ? { upgradedFrom } : {}) };
}

/**
 * What the Worker would refuse, so the form can say it before posting. Empty when
 * the submission can go. `blocks` is the release's block count.
 */
export function submissionProblems(submission: Submission, limits: { blocks: number }): string[] {
  const problems: string[] = [];
  const title = submission.title.trim();
  const words = GALLERY_TEXT.form.problems;
  if (!title) problems.push(words.noTitle);
  if (title.length > SUBMISSION_LIMITS.titleCharacters) problems.push(words.longTitle(SUBMISSION_LIMITS.titleCharacters));
  if (submission.credit.trim().length > SUBMISSION_LIMITS.creditCharacters) {
    problems.push(words.longCredit(SUBMISSION_LIMITS.creditCharacters));
  }
  if (submission.image.size > SUBMISSION_LIMITS.imageBytes) problems.push(words.largeImage);
  if (new Blob([JSON.stringify(submission.recipe)]).size > SUBMISSION_LIMITS.recipeBytes) problems.push(words.largeRecipe);
  for (const problem of validateRecipe(submission.recipe, limits)) problems.push(words.recipe(problem));
  return problems;
}

/**
 * Why a saved creation cannot be submitted as it is, beyond the Worker's limits.
 * A creation whose image was made by an earlier objective (storage/creations.ts
 * `upgradedFrom`) would not be reproduced by its upgraded recipe, so it must be run
 * again first.
 */
export function creationProblems(creation: { upgradedFrom?: UpgradedFrom }): string[] {
  if (creation.upgradedFrom === undefined) return [];
  return [GALLERY_TEXT.form.problems.remake(UPGRADED_IMAGE_REASON[creation.upgradedFrom])];
}

/** The Worker verifies the token; null is used when the build has no Turnstile site key. */
export async function submitCreation(submission: Submission, turnstileToken: string | null, fetcher: Fetch = fetch): Promise<{ id: string }> {
  const form = new FormData();
  form.append("image", submission.image, "image.png");
  form.append("recipe", new Blob([JSON.stringify(submission.recipe)], { type: "application/json" }), "recipe.json");
  form.append("title", submission.title.trim());
  form.append("credit", submission.credit.trim());
  const engine = submission.engine?.trim();
  if (engine) form.append("engine", engine);
  if (turnstileToken !== null) form.append("turnstileToken", turnstileToken);
  const response = await fetcher("/api/submissions", { method: "POST", body: form });
  if (!response.ok) throw new Error(await refusal(response));
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new Error(GALLERY_TEXT.fetch.noId);
  return { id: body.id };
}

function galleryEntry(value: unknown, position: number, assetBase: URL): GalleryEntry {
  const entry = value as Record<string, unknown>;
  const fields = ["id", "title", "credit", "imageUrl", "recipeUrl", "publishedAt"] as const;
  for (const field of fields) {
    if (typeof entry?.[field] !== "string") throw new Error(GALLERY_TEXT.fetch.entryField(position, field));
  }
  return {
    id: entry.id as string,
    title: entry.title as string,
    credit: entry.credit as string,
    imageUrl: new URL(entry.imageUrl as string, assetBase).href,
    thumbnailUrl: typeof entry.thumbnailUrl === "string" ? new URL(entry.thumbnailUrl, assetBase).href : null,
    recipeUrl: new URL(entry.recipeUrl as string, assetBase).href,
    publishedAt: entry.publishedAt as string,
    ...(typeof entry.engine === "string" && entry.engine !== "" ? { engine: entry.engine } : {}),
  };
}

/** The Worker's own message when it gives one, so the visitor sees why. */
export async function refusal(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: fall through to the status line.
  }
  return GALLERY_TEXT.fetch.refused(response.status, text.slice(0, 200));
}
