// addresses/<image_id>.bin: the address of every token of one picture, the 32 blocks
// that read it.
//
// Packed little-endian rows, unaligned, one row per token slot (0 CLS, 1–4 storage,
// 5–260 patches), 448 bytes each:
//   32 winners, strongest first (projection energy ‖c‖², ties by block id), each
//     block  uint16
//     code   float32 [3]   the token's gain-free code in that block
// A file is 261 rows, 116,928 bytes. The app reads the one row of a request's token
// with a range request. A request's other blocks are copied from it (recipe.ts alsoBlocks).

import { TOKEN_SLOTS, type AddressBlock, type Token } from "../recipe";

/** Every token is read by its 32 strongest blocks: the dictionary's top K. */
export const ADDRESS_BLOCKS = 32;
const WINNER_BYTES = 2 + 3 * 4;
export const ADDRESS_ROW_BYTES = ADDRESS_BLOCKS * WINNER_BYTES;
export const ADDRESS_FILE_BYTES = TOKEN_SLOTS * ADDRESS_ROW_BYTES;

/** One token's address: its 32 blocks, strongest first, each with the token's code in it. */
export interface TokenAddress {
  token: Token;
  blocks: AddressBlock[];
}

/** The address in one row of a token's address file; checks the row's length and that its blocks are distinct. */
export function decodeAddressRow(buffer: ArrayBuffer, token: Token): TokenAddress {
  if (buffer.byteLength !== ADDRESS_ROW_BYTES) {
    throw new Error(`the selected responses of slot ${token.slot} are ${buffer.byteLength} bytes, not ${ADDRESS_ROW_BYTES}`);
  }
  const view = new DataView(buffer);
  const blocks: AddressBlock[] = [];
  const seen = new Set<number>();
  for (let winner = 0; winner < ADDRESS_BLOCKS; winner++) {
    const offset = winner * WINNER_BYTES;
    const block = view.getUint16(offset, true);
    if (seen.has(block)) throw new Error(`the selected responses of slot ${token.slot} list basis group ${block} twice`);
    seen.add(block);
    const code: AddressBlock["code"] = [view.getFloat32(offset + 2, true), view.getFloat32(offset + 6, true), view.getFloat32(offset + 10, true)];
    blocks.push({ block, code });
  }
  return { token, blocks };
}

/** A row in the file's layout, for fixtures and tests. */
export function encodeAddressRow(blocks: readonly AddressBlock[]): Uint8Array<ArrayBuffer> {
  if (blocks.length !== ADDRESS_BLOCKS) throw new Error(`a row of selected responses has ${ADDRESS_BLOCKS} basis groups, not ${blocks.length}`);
  const bytes = new Uint8Array(ADDRESS_ROW_BYTES);
  const view = new DataView(bytes.buffer);
  blocks.forEach(({ block, code }, winner) => {
    const offset = winner * WINNER_BYTES;
    view.setUint16(offset, block, true);
    code.forEach((value, axis) => view.setFloat32(offset + 2 + axis * 4, value, true));
  });
  return bytes;
}
