// Cloudflare Turnstile, the Worker's half. The app's widget gives the visitor a token,
// which the submission form carries as the text field turnstileToken. The Worker asks
// siteverify whether the token is valid. A token is valid once, for 300 seconds.
//
// The Worker needs the secret TURNSTILE_SECRET: without it, it refuses every submission (503) rather
// than store one unchecked (worker.ts). A local `wrangler dev` passes Cloudflare's test secret, which
// always passes, or a placeholder, which refuses every token.

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TOKEN_FIELD = "turnstileToken";
/** Cloudflare's limit; a longer value is not a token. */
const TOKEN_MAX_CHARACTERS = 2048;

export type HumanCheck = { ok: true } | { ok: false; status: 403 | 503; error: string };

const FAILED: HumanCheck = { ok: false, status: 403, error: "The check failed; try again." };

/** Ask siteverify about one token. A missing or rejected token is 403; an unreachable siteverify is 503. */
export async function verifyTurnstile(token: string | null, secret: string, remoteIp: string | null): Promise<HumanCheck> {
  if (token === null || token === "" || token.length > TOKEN_MAX_CHARACTERS) return FAILED;
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null) form.set("remoteip", remoteIp);
  try {
    const response = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    if (!response.ok) throw new Error(`siteverify answered ${response.status}`);
    const outcome: unknown = await response.json();
    if (typeof outcome !== "object" || outcome === null || !("success" in outcome) || typeof outcome.success !== "boolean") {
      throw new Error("siteverify returned an invalid response");
    }
    return outcome.success ? { ok: true } : FAILED;
  } catch {
    return { ok: false, status: 503, error: "The check is unavailable; try again in a minute." };
  }
}
