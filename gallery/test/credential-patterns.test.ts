// The credential patterns of the pre-push scan. Every sample is put together at run time from parts,
// so that the lines this file adds never match a pattern when the scanner reads them.

import { describe, expect, it } from "vitest";
import { credentialNames } from "../src/credential-patterns.ts";

const repeat = (alphabet: string, length: number) => Array.from({ length }, (_, index) => alphabet[(index * 7) % alphabet.length]).join("");
const alphanumeric = repeat("aB3dE5gH7jK9mN1pQ", 36);
const hex = (length: number) => repeat("0123456789abcdef", length);
const join = (...parts: string[]) => parts.join("");

describe("credential patterns", () => {
  it.each([
    ["Cloudflare API token (assigned)", join("CLOUDFLARE_API", "_TOKEN=", repeat("aZ09_-xY", 40))],
    ["Cloudflare API token (assigned)", join('  "CF_API', '_TOKEN": "', repeat("aZ09_-xY", 40), '"')],
    ["Cloudflare global API key (X-Auth-Key)", join("X-Auth", "-Key: ", hex(37))],
    ["R2 or S3 access key id (assigned)", join("access_key", "_id = ", hex(32))],
    ["R2 or S3 access key id (assigned)", join("R2_ACCESS_KEY", "_ID=", hex(32))],
    ["R2 or S3 secret access key (assigned)", join("secret_access", "_key = ", hex(64))],
    ["R2 or S3 secret access key (assigned)", join("AWS_SECRET_ACCESS", "_KEY=", repeat("aZ09/+xY", 40))],
    ["GitHub token (ghp_, gho_, ghu_, ghs_, ghr_)", join("token gh", "p_", alphanumeric)],
    ["GitHub token (ghp_, gho_, ghu_, ghs_, ghr_)", join("gh", "s_", alphanumeric)],
    ["GitHub fine-grained token (github_pat_)", join("github", "_pat_", repeat("aB3_dE5", 82))],
    ["Hugging Face token (hf_)", join("HF_TOKEN=h", "f_", repeat("aB3dE5gH7j", 34))],
    ["private key (PEM)", join("-----BEGIN", " PRIVATE KEY-----")],
    ["private key (PEM)", join("-----BEGIN", " OPENSSH PRIVATE KEY-----")],
    ["private key (PEM)", join("-----BEGIN", " EC PRIVATE KEY-----")],
    ["Turnstile secret key", join("TURNSTILE_SECRET=0", "x4AAAAAA", repeat("AB3dE5gH", 26))],
  ])("finds a %s", (name, line) => {
    expect(credentialNames(`+${line}`)).toContain(name);
  });

  it.each([
    ["a recorded SHA-256 digest", join('  "materialSha256": "', hex(64), '",')],
    ["a qualified engine digest", join('  "sha256": "', hex(64), '"')],
    ["a source hash", join("sourceSha256: ", hex(64))],
    ["an MD5 ETag", join('etag: "', hex(32), '"')],
    ["a commit id", join("pinned at ", hex(40))],
    ["an action pinned by commit", join("uses: actions/checkout@", hex(40), " # v6")],
    ["the public Turnstile site key", join("VITE_TURNSTILE_SITE_KEY=0", "x4", repeat("AAAAAAAF", 21))],
    ["Cloudflare's always-pass test secret", join("TURNSTILE_SECRET=1x", "0".repeat(31), "AA")],
    ["a workflow's secret reference", "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"],
    ["the rclone wrapper's variable mapping", 'export RCLONE_CONFIG_LIBRARY_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"'],
    ["a public key", join("-----BEGIN", " PUBLIC KEY-----")],
    ["a run inside base64 weights", join('"values": "Qm9v', "0x4AAAAAA", repeat("AB3dE5gH", 40), '"')],
  ])("leaves %s alone", (_, line) => {
    expect(credentialNames(`+${line}`)).toEqual([]);
  });
});
