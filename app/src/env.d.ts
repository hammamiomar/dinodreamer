/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Source revision recorded by Vite when this app build starts. */
  readonly VITE_BUILD_REVISION: string;
  /** Public data bucket. */
  readonly ASSET_BASE_URL: string;
  /** Release manifest name under releases/, e.g. "pass-003". */
  readonly ASSET_RELEASE: string;
  /** Cloudflare Turnstile site key for the gallery submit form; absent or empty turns the check off. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
