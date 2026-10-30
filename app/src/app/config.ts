// Where the public release lives, which release new creations pin, and the
// gallery's Turnstile site key. All come from app/.env (or a mode's .env file),
// so a build names its data and services explicitly.

import type { ReleaseLocation } from "../synthesis/protocol";

/** ASSET_BASE_URL, the public data bucket, without a trailing slash. */
export const ASSET_BASE_URL = import.meta.env.ASSET_BASE_URL.replace(/\/+$/, "");

/** The release a new creation pins in `recipe.release`, e.g. "pass-003". */
export const RELEASE_NAME = import.meta.env.ASSET_RELEASE;

/** What the synthesis worker's `load` command needs to find the same release. */
export const RELEASE_LOCATION: ReleaseLocation = {
  baseUrl: ASSET_BASE_URL,
  manifestPath: `releases/${RELEASE_NAME}.json`,
};

/**
 * The engine build this app was built with, for the provenance of saved images: the
 * engine's wasm asset name in the library bucket (ASSET_ENGINE_WASM, set by the
 * deploy; synthesis/engine.worker.ts loads it), or "bundled" when the build carries
 * its own wasm (dev, fixtures).
 */
export const ENGINE_BUILD_NAME: string = (import.meta.env as ImportMetaEnv & { ASSET_ENGINE_WASM?: string }).ASSET_ENGINE_WASM ?? "bundled";

/**
 * Cloudflare Turnstile site key for the gallery submit form. Public. Empty means
 * the form shows no check and posts no token.
 */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";
