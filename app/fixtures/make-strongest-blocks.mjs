// Writes the fixture's strongest-blocks files
// from the fixture's own observation records, with the producer's rule
// restricted to blocks 0–7, the blocks the fixture has records for:
//   - a block is a candidate where it is among a token's top 32 (the gated flag);
//   - the entry is the block's best gated token by relative = ‖c‖ / map_scale of its role;
//   - cells are the gated patch cells; entries are ordered by relative, at most 24.
// The production files come from ../dinoDreamer/deploy/public/strongest_blocks.py.
//
// Run from app/: node fixtures/make-strongest-blocks.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const READOUT = join(import.meta.dirname, "web/v2/readouts/a8d6b0022652213f3916c6c348655a0af47bd51c7b1563e058fec4bfb81d6990");
const BLOCKS = [0, 1, 2, 3, 4, 5, 6, 7];
const RECORD_BYTES = 3409;
const SLOTS = 261;
const PATCH_START = 5;
const CODES_AT = 16;
const GATED_AT = 3148;
const LISTED_BLOCKS = 24;
const ROLES = ["cls", "storage0", "storage1", "storage2", "storage3"];

const roleOf = (slot) => (slot < PATCH_START ? ROLES[slot] : "patch");
/** float32 norm in NumPy's order, as the app computes it (library/observations.ts). */
const norm = (x, y, z) => Math.fround(Math.sqrt(Math.fround(Math.fround(Math.fround(x * x) + Math.fround(y * y)) + Math.fround(z * z))));
/** Nine significant digits, as the producer's JSON. */
const json9 = (value) => Number(value.toPrecision(9));

const entriesByImage = new Map();
for (const block of BLOCKS) {
  const stats = JSON.parse(readFileSync(join(READOUT, `blocks/${block}.json`), "utf8")).stats.roles;
  const bytes = readFileSync(join(READOUT, `observations/${block}.bin`));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += RECORD_BYTES) {
    const imageId = Number(view.getBigInt64(offset, true));
    let best = null;
    const cells = [];
    for (let slot = 0; slot < SLOTS; slot += 1) {
      if (view.getUint8(offset + GATED_AT + slot) === 0) continue;
      if (slot >= PATCH_START) cells.push(slot - PATCH_START);
      const at = offset + CODES_AT + slot * 12;
      const code = [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)];
      const response = norm(...code);
      const relative = Math.fround(response / stats[roleOf(slot)].map_scale);
      if (!best || relative > best.relative) best = { block, role: roleOf(slot), slot, code, response, relative };
    }
    if (!best) continue;
    const entry = { ...best, code: best.code.map(json9), response: json9(best.response), relative: json9(best.relative), cells };
    entriesByImage.set(imageId, [...(entriesByImage.get(imageId) ?? []), entry]);
  }
}

mkdirSync(join(READOUT, "strongest-blocks"), { recursive: true });
for (const [imageId, entries] of entriesByImage) {
  const blocks = entries.sort((a, b) => b.relative - a.relative || a.block - b.block).slice(0, LISTED_BLOCKS);
  const file = { format: 1, image_id: imageId, ranked_by: "relative", blocks };
  writeFileSync(join(READOUT, `strongest-blocks/${imageId}.json`), `${JSON.stringify(file)}\n`);
  console.log(imageId, blocks.map((entry) => `${entry.block}:${entry.role}:${entry.relative.toFixed(2)}`).join(" "));
}
