// A gallery submission: reading and checking the multipart form, naming it, and storing it
// as pending objects in the private bucket. Nothing here publishes anything.

import { validateRecipe, type Recipe } from "../../app/src/recipe.ts";
import { parseRecipe } from "../../app/src/recipe-parse.ts";
import { submissionLabelProblem } from "../../app/src/features/gallery/submission-label.ts";
import { isPng, pendingKey, type Bucket, type SubmissionMetadata } from "./storage.ts";
import { TOKEN_FIELD } from "./turnstile.ts";
import { MATERIAL_LIMITS, checkedMaterial, materialPoster, type MaterialSubmission } from "./material-review.ts";

export { isPng };

export const SUBMISSION_LIMITS = {
  imageBytes: 2 * 1024 * 1024,
  recipeBytes: 64 * 1024,
  titleCharacters: 80,
  creditCharacters: 40,
  engineCharacters: 128,
  /** The whole multipart body: both files at their limits plus the form's own framing. */
  requestBytes: 2 * 1024 * 1024 + 64 * 1024 + 16 * 1024,
} as const;

export interface Submission {
  image: Uint8Array;
  /** Rebuilt by the structural parser from known fields only, then checked by validateRecipe. */
  recipe: Recipe;
  title: string;
  credit: string;
  /**
   * The engine build that made the image: the engine's wasm asset name, as the app records
   * it in a saved creation. A later build can drift in the third decimal, so a replay is
   * attributed to its build. Absent when the form sent none.
   */
  engine?: string;
}

export type SubmissionResult =
  /** turnstileToken is the form's human-check token, not part of the submission; null when absent. */
  | { ok: true; submission: Submission; turnstileToken: string | null }
  | { ok: false; status: number; error: string; problems?: string[] };

function refused(status: number, error: string, problems?: string[]): SubmissionResult {
  return problems === undefined ? { ok: false, status, error } : { ok: false, status, error, problems };
}


/** The block count of a published release, or null when no such release exists. */
export type ReleaseBlocks = (release: string) => Promise<number | null>;

const RELEASE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
/**
 * Formats 5–7 preserve the submitted image when upgraded: format 6 uses point targets at
 * radius 1, and format 5 targets one block per request. Earlier formats use different
 * objectives or optimizer rules, so an upgraded recipe cannot reproduce their images.
 */
const GALLERY_RECIPE_FORMATS: readonly unknown[] = [5, 6, 7];
const CURRENT_RECIPE_FORMAT = 7;

/**
 * An untrusted recipe, checked the way recipe.ts requires at every boundary: the current
 * format, then the app's structural parser (field types, array lengths, token slots), then validateRecipe
 * with the block count of the release the recipe names, which must exist.
 */
export async function checkedRecipe(
  value: unknown,
  releaseBlocks: ReleaseBlocks,
): Promise<{ recipe: Recipe } | { error: string; problems?: string[] }> {
  const format = typeof value === "object" && value !== null ? (value as { format?: unknown }).format : undefined;
  if (!GALLERY_RECIPE_FORMATS.includes(format)) {
    return { error: `image-editing configuration must be format ${CURRENT_RECIPE_FORMAT}; reload the app and submit again` };
  }
  let recipe: Recipe;
  try {
    recipe = parseRecipe(value);
  } catch (error) {
    return { error: `image-editing configuration has the wrong structure: ${error instanceof Error ? error.message : String(error)}` };
  }
  const blocks = RELEASE_NAME.test(recipe.release) ? await releaseBlocks(recipe.release) : null;
  if (blocks === null) return { error: `image-editing configuration names an unknown release: ${recipe.release.slice(0, 64)}` };
  const problems = validateRecipe(recipe, { blocks });
  return problems.length > 0 ? { error: `image-editing configuration is not valid: ${problems.join("; ")}`, problems } : { recipe };
}

/** A text field's trimmed value, or an error when it is too long or contains control characters. */
function textField(form: FormData, name: string, limit: number): { value: string } | { error: string } {
  const raw = form.get(name) ?? "";
  if (typeof raw !== "string") return { error: `${name} must be text` };
  const value = raw.trim();
  const problem = submissionLabelProblem(value, limit);
  if (problem === "too-long") return { error: `${name} has more than ${limit} characters` };
  if (problem === "control-characters") return { error: `${name} contains control characters` };
  return { value };
}

/** The request's size and type, then its multipart form: the checks every kind of submission shares. */
export async function readForm(request: Request): Promise<{ ok: true; form: FormData } | { ok: false; status: number; error: string }> {
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) return { ok: false, status: 411, error: "the request needs a Content-Length" };
  if (declared > SUBMISSION_LIMITS.requestBytes) return { ok: false, status: 413, error: "the submission is too large" };
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return { ok: false, status: 415, error: "send the submission as multipart/form-data" };
  }
  try {
    return { ok: true, form: await request.formData() };
  } catch {
    return { ok: false, status: 400, error: "the form could not be read" };
  }
}

/**
 * Validate a material submission (`kind=material`) with the app's format-4 loader.
 * Shader source is never accepted; the app generates shaders from the weights.
 */
export async function readMaterialForm(form: FormData):
  Promise<{ ok: true; submission: MaterialSubmission; turnstileToken: string | null } | { ok: false; status: number; error: string }> {
  // The file is the only content: any other field, such as a shader, is refused rather than ignored.
  const unexpected = [...new Set(form.keys())].filter((name) => !MATERIAL_FORM_FIELDS.includes(name));
  if (unexpected.length > 0) return { ok: false, status: 400, error: `unexpected form field: ${unexpected.join(", ").slice(0, 80)}` };
  const field = form.get("material");
  if (field === null) return { ok: false, status: 400, error: "automaton definition is missing" };
  const text = typeof field === "string" ? field : await field.text();
  const checked = checkedMaterial(text);
  if ("error" in checked) return { ok: false, status: checked.error.includes("larger") ? 413 : 400, error: checked.error };
  const title = textField(form, "title", MATERIAL_LIMITS.titleCharacters);
  if ("error" in title) return { ok: false, status: 400, error: title.error };
  const credit = textField(form, "credit", MATERIAL_LIMITS.creditCharacters);
  if ("error" in credit) return { ok: false, status: 400, error: credit.error };
  const token = form.get(TOKEN_FIELD);
  return {
    ok: true,
    submission: { file: checked.file, text: JSON.stringify(checked.file), poster: materialPoster(checked.file), title: title.value, credit: credit.value },
    turnstileToken: typeof token === "string" ? token : null,
  };
}

/** The fields a material submission may carry: its kind, the file, two labels and the human check. */
const MATERIAL_FORM_FIELDS: readonly string[] = ["kind", "material", "title", "credit", TOKEN_FIELD];

/** A canvas submission: its picture, its recipe and its labels. */
export async function readCreationForm(form: FormData, releaseBlocks: ReleaseBlocks): Promise<SubmissionResult> {
  const image = form.get("image");
  if (image === null || typeof image === "string") return refused(400, "image must be a PNG file");
  if (image.size > SUBMISSION_LIMITS.imageBytes) return refused(413, "image is larger than 2 MB");
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  if (!isPng(imageBytes)) return refused(400, "image must be a PNG file");

  const recipeField = form.get("recipe");
  if (recipeField === null) return refused(400, "image-editing configuration is missing");
  const recipe = typeof recipeField === "string" ? recipeField : await recipeField.text();
  if (new TextEncoder().encode(recipe).length > SUBMISSION_LIMITS.recipeBytes) return refused(413, "image-editing configuration is larger than 64 KB");
  let parsed: unknown;
  try {
    parsed = JSON.parse(recipe);
  } catch {
    return refused(400, "image-editing configuration is not JSON");
  }
  const checked = await checkedRecipe(parsed, releaseBlocks);
  if ("error" in checked) return refused(400, checked.error, checked.problems);

  const title = textField(form, "title", SUBMISSION_LIMITS.titleCharacters);
  if ("error" in title) return refused(400, title.error);
  if (title.value === "") return refused(400, "title is missing");
  const credit = textField(form, "credit", SUBMISSION_LIMITS.creditCharacters);
  if ("error" in credit) return refused(400, credit.error);
  const engine = textField(form, "engine", SUBMISSION_LIMITS.engineCharacters);
  if ("error" in engine) return refused(400, engine.error);

  const submission: Submission = { image: imageBytes, recipe: checked.recipe, title: title.value, credit: credit.value };
  if (engine.value !== "") submission.engine = engine.value;
  const token = form.get(TOKEN_FIELD);
  return { ok: true, submission, turnstileToken: typeof token === "string" ? token : null };
}

/** Write the pending objects; meta.json is last, so a listed meta.json means a complete submission. */
export async function storeSubmission(bucket: Bucket, id: string, submission: Submission, now: Date): Promise<SubmissionMetadata> {
  const metadata: SubmissionMetadata = {
    id,
    title: submission.title,
    credit: submission.credit,
    release: submission.recipe.release,
    submittedAt: now.toISOString(),
  };
  if (submission.engine !== undefined) metadata.engine = submission.engine;
  await bucket.put(pendingKey(id, "image.png"), submission.image, { httpMetadata: { contentType: "image/png" } });
  await bucket.put(pendingKey(id, "recipe.json"), JSON.stringify(submission.recipe), { httpMetadata: { contentType: "application/json" } });
  await bucket.put(pendingKey(id, "meta.json"), JSON.stringify(metadata, null, 2), { httpMetadata: { contentType: "application/json" } });
  return metadata;
}
