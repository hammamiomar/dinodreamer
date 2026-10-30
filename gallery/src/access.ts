// Who may use the owner routes. Cloudflare Access sits in front of /admin on
// dinodreamer.computervision.vision and adds a signed token to each request it lets through
// (Cf-Access-Jwt-Assertion). The Worker checks that token itself, so the routes stay closed
// when the Access application is missing or wrong, and on the workers.dev address, which
// Access does not cover. The check follows Cloudflare's guide
// (developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/):
// RS256 against the team's published keys, matched by kid and fetched at request time, so a
// key rotation needs nothing here; then the issuer (the team domain), the audience (the
// application's AUD tag) and the token's lifetime.
//
// Under wrangler dev there is no Access. The local owner is admitted only when the dev command
// sets the var ADMIN_LOCAL_OWNER and the request goes to this machine (127.0.0.1 or localhost);
// production never sets the var (a test checks wrangler.jsonc).

export const ACCESS_TOKEN_HEADER = "cf-access-jwt-assertion";

export interface OwnerAccessEnv {
  /** https://<team>.cloudflareaccess.com, the Zero Trust team domain. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's Application Audience (AUD) tag. */
  ACCESS_AUD?: string;
  /** "yes" on the wrangler dev command line only: the local owner bypass. */
  ADMIN_LOCAL_OWNER?: string;
}

export type OwnerCheck = { ok: true; owner: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** How long the team's keys are reused before they are fetched again; an unknown kid fetches at once. */
const KEYS_MAX_AGE_MS = 5 * 60_000;

type SigningKey = JsonWebKey & { kid?: string };
let teamKeys: { teamDomain: string; fetchedAt: number; keys: SigningKey[] } | null = null;

/** The owner routes' gate: the local owner under wrangler dev, or a valid Access token. */
export async function checkOwner(request: Request, env: OwnerAccessEnv, now: Date, fetcher: typeof fetch = fetch): Promise<OwnerCheck> {
  if (env.ADMIN_LOCAL_OWNER === "yes" && LOCAL_HOSTS.has(new URL(request.url).hostname)) return { ok: true, owner: "local owner" };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return { ok: false, reason: "owner access is not configured" };
  const teamDomain = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, "");
  return verifyAccessToken(request.headers.get(ACCESS_TOKEN_HEADER), teamDomain, env.ACCESS_AUD, now, fetcher);
}

export async function verifyAccessToken(
  token: string | null,
  teamDomain: string,
  audience: string,
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<OwnerCheck> {
  if (!token) return { ok: false, reason: "no Access token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed Access token" };
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  let header: unknown;
  let payload: unknown;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlBytes(encodedHeader)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlBytes(encodedPayload)));
    signature = base64UrlBytes(encodedSignature);
  } catch {
    return { ok: false, reason: "malformed Access token" };
  }
  // JSON.parse also returns null, numbers and arrays; a token's header and payload are objects.
  if (!isJsonObject(header) || !isJsonObject(payload)) return { ok: false, reason: "malformed Access token" };
  if (header.alg !== "RS256") return { ok: false, reason: "the Access token is not RS256" };

  let key: SigningKey | null;
  try {
    key = await signingKey(teamDomain, String(header.kid), now, fetcher);
  } catch (error) {
    return { ok: false, reason: `the team's keys could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (key === null) return { ok: false, reason: "the Access token's key is not the team's" };
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  let valid: boolean;
  try {
    const verifier = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", verifier, signature, signed);
  } catch (error) {
    return { ok: false, reason: `the Access token's signature could not be checked: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!valid) return { ok: false, reason: "bad Access token signature" };

  if (payload.iss !== teamDomain) return { ok: false, reason: "the Access token is from another team" };
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return { ok: false, reason: "the Access token is for another application" };
  const seconds = now.getTime() / 1000;
  if (typeof payload.exp !== "number" || payload.exp <= seconds) return { ok: false, reason: "the Access token has expired" };
  if (typeof payload.nbf === "number" && payload.nbf > seconds) return { ok: false, reason: "the Access token is not valid yet" };
  return { ok: true, owner: typeof payload.email === "string" ? payload.email : "owner" };
}

/** The team key with this kid: from the kept keys, or fetched again when they are old or lack it. */
async function signingKey(teamDomain: string, kid: string, now: Date, fetcher: typeof fetch): Promise<SigningKey | null> {
  const kept = teamKeys !== null && teamKeys.teamDomain === teamDomain && now.getTime() - teamKeys.fetchedAt < KEYS_MAX_AGE_MS;
  const known = kept ? teamKeys!.keys.find((key) => key.kid === kid) : undefined;
  if (known !== undefined) return known;
  const response = await fetcher(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`${teamDomain}/cdn-cgi/access/certs answered ${response.status}`);
  const { keys } = (await response.json()) as { keys?: SigningKey[] };
  teamKeys = { teamDomain, fetchedAt: now.getTime(), keys: keys ?? [] };
  return teamKeys.keys.find((key) => key.kid === kid) ?? null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
