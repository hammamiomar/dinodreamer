// Scan the lines that a range of commits adds for credential patterns, before a push makes them public:
//   node gallery/scan-commits-for-credentials.ts <repository> <range>     for example . origin/main..main
// It prints the commit, the file and the pattern's name of each match, never the matched text, and
// exits 1 when anything matches.

import { execFileSync } from "node:child_process";

const PATTERNS: Record<string, RegExp> = {
  "Hugging Face token (hf_)": /\bhf_[A-Za-z0-9]{30,}/,
  "Anthropic key (sk-ant-)": /sk-ant-[A-Za-z0-9_-]{10,}/,
  "AWS access key (AKIA)": /\bAKIA[0-9A-Z]{16}\b/,
  // The character class keeps this line from matching itself when the scanner scans its own file.
  "presigned URL (X-Amz-Signature)": /X-Amz-Signature[=]/i,
  "Turnstile key (0x4AAAAAAA)": /0x4AAAAAAA[A-Za-z0-9_-]{6,}/,
  "bearer token": /Bearer [A-Za-z0-9_-]{30,}/,
};

const [repository, range] = process.argv.slice(2);
if (!repository || !range) throw new Error("usage: node gallery/scan-commits-for-credentials.ts <repository> <range>");
const log = execFileSync("git", ["-C", repository, "log", "-p", "--no-color", "--format=commit %h", range], { encoding: "utf8", maxBuffer: 1 << 30 });
const matches: string[] = [];
let commit = "";
let file = "";
for (const line of log.split("\n")) {
  if (line.startsWith("commit ")) commit = line.slice(7);
  else if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
  else if (line.startsWith("+")) {
    for (const [name, pattern] of Object.entries(PATTERNS)) if (pattern.test(line)) matches.push(`${commit} ${file}: ${name}`);
  }
}
console.log(`${matches.length} matches in ${range}`);
for (const match of matches) console.log(match);
process.exitCode = matches.length ? 1 : 0;
