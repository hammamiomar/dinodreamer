// The names How's figures give a token and a cell, in the words file's terms (site-words.ts, how).
// Counted from 1, as a person counts.

import { fill, SITE_WORDS } from "../../app/site-words";
import { PREFIX } from "./how-shapes";

const WORDS = SITE_WORDS.how;

/** Token 0 is the class token, 1–4 the registers, then the patches row by row. */
export function tokenName(token: number): string {
  if (token === 0) return WORDS.tokenClass;
  if (token < PREFIX) return fill(WORDS.tokenRegister, { index: token });
  const patch = token - PREFIX;
  return fill(WORDS.tokenPatch, { row: Math.floor(patch / 16) + 1, column: (patch % 16) + 1 });
}

/** A grid cell by its column and row. */
export function cellName(cell: number, side: number): string {
  return fill(WORDS.cellName, { column: (cell % side) + 1, row: Math.floor(cell / side) + 1 });
}
