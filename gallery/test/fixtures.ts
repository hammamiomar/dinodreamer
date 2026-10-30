// Shared test fixtures: a submitted picture and recipe, a Worker environment on memory buckets
// with a stand-in for the Images binding, and a submission through the Worker.

import sharp from "sharp";
import { CELLS, OPTIMIZER_DEFAULT, type Recipe } from "../../app/src/recipe.ts";
import { sharpThumbnail } from "../src/thumbnail-sharp.ts";
import type { ImageTransformer, ImagesBinding } from "../src/thumbnail.ts";
import worker, { type Env } from "../src/worker.ts";
import { MemoryBucket } from "./memory-bucket.ts";

/** What the Worker asked the Images binding for: the transforms and the output. */
export interface ImageCall {
  transforms: Parameters<ImageTransformer["transform"]>[0][];
  output: Parameters<ImageTransformer["output"]>[0];
}

/** The Images binding's call shape, with sharp standing in for Cloudflare's encoder. */
export function imageServiceStub(calls: ImageCall[]): ImagesBinding {
  return {
    input(stream) {
      const transforms: ImageCall["transforms"] = [];
      const transformer: ImageTransformer = {
        transform(options) {
          transforms.push(options);
          return transformer;
        },
        async output(options) {
          calls.push({ transforms, output: options });
          const webp = await sharpThumbnail(await new Response(stream).arrayBuffer());
          return { response: () => new Response(webp, { headers: { "content-type": options.format } }) };
        },
      };
      return transformer;
    },
  };
}

/** A one-colour PNG, as a test image: the approval decodes it for the thumbnail. */
export async function flatPng(width: number, height: number, colour: { r: number; g: number; b: number }): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer());
}

export const PNG_COLOUR = { r: 200, g: 40, b: 90 };
/** The image the app submits: 256 × 256 (creation-autosave.ts). */
export const PNG = await flatPng(256, 256, PNG_COLOUR);

export function recipe(): Recipe {
  const token = { imageId: 7, role: "patch" as const, slot: 141 };
  const area = Array.from({ length: CELLS }, (_, cell) => cell === 136 ? 100 : 0);
  return {
    format: 7,
    release: "pass-003",
    seed: 1,
    requests: [
      {
        id: 1,
        block: 6,
        respondLike: {
          enabled: true, weight: 0.3, source: token, code: [1, 0, 0], target: { kind: "point" }, radius: 1, where: area, alsoBlocks: [],
        },
        lookLike: { enabled: false, weight: 1, references: [], where: area },
      },
    ],
    protect: Array.from({ length: CELLS }, () => false),
    rules: { tv: { enabled: false, weight: 0 }, l2: { enabled: false, weight: 0 } },
    motion: { zoomPerUpdate: 0 },
    optimizer: { ...OPTIMIZER_DEFAULT },
  };
}

/** Cloudflare's Turnstile test secret and the token its test site key gives; test/siteverify.ts accepts that token. */
export const TEST_TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";
export const TEST_TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export function testEnv(allowed = true) {
  const assetRequests: string[] = [];
  const imageCalls: ImageCall[] = [];
  const env: Env = {
    SUBMISSIONS: new MemoryBucket(),
    LIBRARY: new MemoryBucket(),
    ASSETS: {
      fetch: async (request: Request) => {
        assetRequests.push(new URL(request.url).pathname);
        return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
      },
    },
    SUBMISSION_LIMIT: { limit: async () => ({ success: allowed }) },
    IMAGES: imageServiceStub(imageCalls),
    ASSET_BASE_URL: "https://library.test",
    TURNSTILE_SECRET: TEST_TURNSTILE_SECRET,
  };
  // The published release manifest that names the dictionary size.
  void (env.LIBRARY as MemoryBucket).put("releases/pass-003.json", JSON.stringify({ format: 1, release: "pass-003", model: { blocks: 16384 } }));
  return { env, submissions: env.SUBMISSIONS as MemoryBucket, library: env.LIBRARY as MemoryBucket, assetRequests, imageCalls };
}

/** A multipart request the way the app's submitCreation builds it, with an explicit Content-Length. */
export async function submissionRequest(
  fields: { image?: Uint8Array<ArrayBuffer>; recipe?: string; title?: string; credit?: string; engine?: string; turnstileToken?: string | null } = {},
) {
  const form = new FormData();
  form.append("image", new Blob([fields.image ?? PNG], { type: "image/png" }), "image.png");
  form.append("recipe", new Blob([fields.recipe ?? JSON.stringify(recipe())], { type: "application/json" }), "recipe.json");
  form.append("title", fields.title ?? "Collar");
  form.append("credit", fields.credit ?? "Contributor");
  if (fields.engine !== undefined) form.append("engine", fields.engine);
  // The app's widget gives a token; null leaves it out.
  const token = fields.turnstileToken === undefined ? TEST_TURNSTILE_TOKEN : fields.turnstileToken;
  if (token !== null) form.append("turnstileToken", token);
  const encoded = new Request("https://app.test/api/submissions", { method: "POST", body: form });
  const body = new Uint8Array(await encoded.arrayBuffer());
  return new Request("https://app.test/api/submissions", {
    method: "POST",
    body,
    headers: { "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length), "cf-connecting-ip": "203.0.113.9" },
  });
}

export async function submit(env: Env, fields: Parameters<typeof submissionRequest>[0] = {}) {
  const response = await worker.fetch(await submissionRequest(fields), env);
  return { status: response.status, body: (await response.json()) as { id?: string; error?: string; problems?: string[] } };
}
