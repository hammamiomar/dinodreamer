// The record that turns one recorded token into an editor request.
//
// A reference names a token and its block and, when the source knows it, the
// token's code. A basis group's page knows codes (its cloud rows carry them).
// `resolveTokenHandoff` turns a reference into a TokenHandoff, reading a missing
// code from observations/<block>.bin through the library cache, so the editor's
// `createRequest` always has a code from the release.
//
// A handoff also carries the block's strong examples for the token's role, from
// blocks/<block>.json: the pictures a new request's Appearance starts from.

import type { Code, Token } from "../recipe";
import { isValidToken } from "../recipe-parse";
import type { Library } from "../library/library";
import { recordedCode } from "../library/observations";
import type { BlockRecord } from "../library/records";
import { slotLibraryRole } from "../library/roles";

export type { Code } from "../recipe";
export { slotRole as tokenRole } from "../recipe-parse";

export interface TokenHandoff {
  token: Token;
  block: number;
  /**
   * The code of `token` in `block`, copied from the release: from observations/<block>.bin,
   * or from the picture's strongest-blocks file when the block has no record of the picture.
   * The app never computes it.
   */
  code: Code;
  /**
   * The block's listed examples for the token's role, as tokens (`strongExamples` below).
   * Every drag source and click fills it; a handoff built without it makes a request
   * from the source picture alone.
   */
  strongExamples?: Token[];
}

/** How many example pictures a handoff carries: the research instrument's default reference count. */
export const MAX_STRONG_EXAMPLES = 8;

/**
 * The block's listed examples for the token's role, as tokens with their own
 * slots: distinct pictures in the record's stored order (the strong band first,
 * then moderate, then variation), the source picture excluded, at most
 * MAX_STRONG_EXAMPLES.
 */
export function strongExamples(record: BlockRecord, source: Token): Token[] {
  const role = slotLibraryRole(source.slot);
  const seen = new Set<number>([source.imageId]);
  const tokens: Token[] = [];
  for (const example of record.examples) {
    if (example.libraryRole !== role || seen.has(example.token.imageId)) continue;
    seen.add(example.token.imageId);
    tokens.push(example.token);
    if (tokens.length === MAX_STRONG_EXAMPLES) break;
  }
  return tokens;
}

/** A token named by its source: a handoff whose code is absent when the source does not know it. */
export interface TokenReference {
  token: Token;
  block: number;
  code?: Code;
}

/**
 * The reference with its recorded code and the block's strong examples. The code is
 * as carried, or read from the block's observation records; the examples come
 * from the block's record (one cached request each per block). Rejects when the
 * release has no record of the picture in that block, or a file cannot be read.
 */
export async function resolveTokenHandoff(library: Pick<Library, "observations" | "block">, drag: TokenReference): Promise<TokenHandoff> {
  const blockRecord = library.block(drag.block);
  if (drag.code) {
    return { token: drag.token, block: drag.block, code: drag.code, strongExamples: strongExamples(await blockRecord, drag.token) };
  }
  const [bundle, examplesOf] = await Promise.all([library.observations(drag.block), blockRecord]);
  const record = bundle.record(drag.token.imageId);
  if (!record) throw new Error(`Basis group ${drag.block} has no record of image ${drag.token.imageId}.`);
  return {
    token: drag.token,
    block: drag.block,
    code: recordedCode(record, drag.token.slot),
    strongExamples: strongExamples(examplesOf, drag.token),
  };
}

export function isTokenReference(value: unknown): value is TokenReference {
  if (typeof value !== "object" || value === null) return false;
  const { token, block, code } = value as Partial<TokenReference>;
  return (
    typeof token === "object" &&
    token !== null &&
    isValidToken(token) &&
    Number.isInteger(block) &&
    (block as number) >= 0 &&
    (code === undefined || isCode(code))
  );
}

function isCode(value: unknown): value is Code {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}
