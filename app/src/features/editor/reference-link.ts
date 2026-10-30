// A link can hand the Painter a reference patch: /create?hold=<block>:<image>:<slot>[:<x>,<y>,<z>].
// The Painter holds it on arrival (state.ts, the held rule) and cleans its address. The code is
// optional: without it, the patch's code is read from the block's records (app/handoff.ts), so a
// link needs it only for a patch the block has no record of, such as a How page's recorded one.

import { tokenRole, type Code, type TokenReference } from "../../app/handoff";
import { isValidToken } from "../../recipe-parse";

/** The reference a link names, or null when the value is not one. */
export function parseReferenceLink(value: string | null): TokenReference | null {
  if (!value) return null;
  const [blockText, imageText, slotText, codeText, ...rest] = value.split(":");
  if (rest.length > 0 || blockText === undefined || imageText === undefined || slotText === undefined) return null;
  const block = Number(blockText);
  const imageId = Number(imageText);
  const slot = Number(slotText);
  if (!Number.isInteger(block) || block < 0 || !Number.isSafeInteger(imageId) || imageId < 0 || !Number.isInteger(slot)) return null;
  const token = { imageId, role: tokenRole(slot), slot };
  if (!isValidToken(token)) return null;
  if (codeText === undefined) return { token, block };
  const parts = codeText.split(",").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { token, block, code: parts as Code };
}

/** The link's value for a reference, the inverse of parseReferenceLink. */
export function referenceLinkValue(reference: TokenReference): string {
  const head = `${reference.block}:${reference.token.imageId}:${reference.token.slot}`;
  return reference.code ? `${head}:${reference.code.join(",")}` : head;
}
