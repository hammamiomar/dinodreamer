// The DINO explorable's arithmetic on the numbers a source returns (how-source.ts). Pure, so the
// figures only draw. T = 261 tokens (token 0 the class token, 1–4 the registers, 5–260 the patches),
// D = 768 channels.

import { PREFIX, TOKENS } from "./how-shapes";

/**
 * One query token's attention over the 261 keys: one head's row, or the mean over the heads.
 * `attention_HTT` is [heads, T, T] (heads = 12 live, 1 recorded: the mean already).
 */
export function attentionRow(attention_HTT: Float32Array, heads: number, query: number, head: number | "mean"): Float32Array {
  const row = new Float32Array(TOKENS);
  const take = head === "mean" ? Array.from({ length: heads }, (_, index) => index) : [head];
  for (const at of take) {
    const offset = (at * TOKENS + query) * TOKENS;
    for (let key = 0; key < TOKENS; key++) row[key]! += attention_HTT[offset + key]! / take.length;
  }
  return row;
}

/** An attention row split as the figure draws it: the five prefix keys, then the 256 patch keys. */
export function splitKeys(row_T: Float32Array): { prefix: Float32Array; patches: Float32Array } {
  return { prefix: row_T.slice(0, PREFIX), patches: row_T.slice(PREFIX) };
}

/**
 * Where a patch's attention goes, as three shares of its row: inside its own 3 × 3 neighbourhood
 * (itself included), outside it on the picture, and to the five prefix tokens. The row is over
 * all 261 keys; the neighbourhood is on the 16 × 16 grid, not a torus.
 */
export function attentionShares(row_T: Float32Array, patch: number): { inside: number; outside: number; prefix: number } {
  const row = Math.floor(patch / 16);
  const column = patch % 16;
  let prefix = 0;
  for (let key = 0; key < PREFIX; key++) prefix += row_T[key]!;
  let inside = 0;
  let outside = 0;
  for (let key = 0; key < 256; key++) {
    const near = Math.abs(Math.floor(key / 16) - row) <= 1 && Math.abs((key % 16) - column) <= 1;
    if (near) inside += row_T[PREFIX + key]!;
    else outside += row_T[PREFIX + key]!;
  }
  return { inside, outside, prefix };
}

/**
 * The three shares as whole percentages of the row that add up to 100: each is rounded down, then
 * the missing points go to the largest remainders. Rounding each share alone can print 101.
 */
export function sharePercents(shares: { inside: number; outside: number; prefix: number }): { inside: number; outside: number; prefix: number } {
  const parts = ["outside", "inside", "prefix"] as const;
  const total = shares.outside + shares.inside + shares.prefix;
  const exact = parts.map((part) => (100 * shares[part]) / total);
  const whole = exact.map(Math.floor);
  const missing = 100 - whole.reduce((sum, value) => sum + value, 0);
  const byRemainder = [0, 1, 2].sort((a, b) => exact[b]! - whole[b]! - (exact[a]! - whole[a]!));
  for (const index of byRemainder.slice(0, missing)) whole[index]! += 1;
  return { outside: whole[0]!, inside: whole[1]!, prefix: whole[2]! };
}

/** A patch's 3 × 3 neighbourhood on the 16 × 16 grid, cut at the picture's edges: its first column and row, and how many of each. */
export function neighbourhoodOf(patch: number): { column: number; row: number; columns: number; rows: number } {
  const column = patch % 16;
  const row = Math.floor(patch / 16);
  const left = Math.max(0, column - 1);
  const top = Math.max(0, row - 1);
  return { column: left, row: top, columns: Math.min(15, column + 1) - left + 1, rows: Math.min(15, row + 1) - top + 1 };
}
