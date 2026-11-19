// The credentials that a commit must not add, by name, for gallery/scan-commits-for-credentials.ts.
// A pattern names a credential by its own shape. When that shape is also the shape of a digest, the
// pattern also needs the name the value is assigned to: an R2 access key id is 32 hex digits and its
// secret 64, as are the MD5 and SHA-256 digests that the repository records. Each pattern is written
// so that its own source line does not match it, because the scanner reads the lines this file adds.

export const CREDENTIAL_PATTERNS: Readonly<Record<string, RegExp>> = {
  "Cloudflare API token (assigned)": /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|CLOUDFLARE_API_KEY|CF_API_KEY)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{37,}/,
  "Cloudflare global API key (X-Auth-Key)": /X-Auth-Key["']?\s*[:=]\s*["']?[0-9a-f]{37}\b/i,
  "R2 or S3 access key id (assigned)": /(?:access[_-]?key[_-]?id|accessKeyId)["']?\s*[:=]\s*["']?[0-9a-f]{32}\b/i,
  "R2 or S3 secret access key (assigned)": /(?:secret[_-]?access[_-]?key|secretAccessKey)["']?\s*[:=]\s*["']?[A-Za-z0-9/+]{40,64}\b/i,
  "GitHub token (ghp_, gho_, ghu_, ghs_, ghr_)": /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  "GitHub fine-grained token (github_pat_)": /\bgithub_pat_[A-Za-z0-9_]{22,}/,
  "Hugging Face token (hf_)": /\bhf_[A-Za-z0-9]{30,}/,
  "private key (PEM)": /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  "Anthropic key (sk-ant-)": /sk-ant-[A-Za-z0-9_-]{10,}/,
  "AWS access key (AKIA)": /\bAKIA[0-9A-Z]{16}\b/,
  // The character class keeps this line from matching itself.
  "presigned URL (X-Amz-Signature)": /X-Amz-Signature[=]/i,
  // A secret key is 35 characters from 0x4AAAAAA; the public site key in app/.env is 24 and does not match,
  // and the end bound keeps a run inside base64 data (a material file's weights) from matching.
  "Turnstile secret key": /\b0x4AAAAAA[A-Za-z0-9_-]{24,28}(?![A-Za-z0-9_+\/=-])/,
  "bearer token": /Bearer [A-Za-z0-9_-]{30,}/,
};

/** The names of the credential patterns that one added line matches. */
export function credentialNames(line: string): string[] {
  return Object.entries(CREDENTIAL_PATTERNS).filter(([, pattern]) => pattern.test(line)).map(([name]) => name);
}
