// Record the NCA explorable's grid for /how's recorded pictures once (CPU only).
//
// /how (app/src/features/how/) steps one tick of a material by hand from its grid at tick 600. The
// page uses this file for a recorded picture. Other pictures use the replay runtime after the engine starts. The
// grid is grown on the CPU by the replay contract's reference (app/src/replay/figure-reference.ts; the
// WGSL runtime agrees with it to float32 rounding) from the material's reading seed, as
// the Playground's player grows it. Stored in float16, so the page's next tick from it is the CPU's,
// not a copy of a player's. Float16 storage adds quantization error to the reference grid.
//
//   grid-600.bin   "HGR1", u16 side, u16 channels, u32 tick, u32 seed; f16 state[side·side·channels]
//                  (row-major cells, 16 channels each)
//
// Reads each material file from the gallery Worker (GET only). Writes next to prepare_how_records.py's
// files in app/public/how/recorded/picture-<id>/.
//
//   node engine/tools/prepare_how_grids.mjs [--ticks 600] [--picture 2985056820452196]

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CHANNELS, referenceStep, startState } from "../../app/src/replay/figure-reference.ts";

// prepare_how_records.py RECORDED: the picture and its anchor block's material grown from noise.
const RECORDED = [
  { imageId: 2985056820452196, material: "block-4009-stage-6-2px-2000-strongest-seed-0" },
  { imageId: 7458416253439473, material: "block-14544-stage-6-noise-strongest-seed-0" },
  { imageId: 3659045719526781, material: "block-12240-stage-6-noise-strongest-seed-0" },
  { imageId: 3358357912530755, material: "block-13364-stage-6-noise-strongest-seed-0" },
];
const GALLERY = "http://127.0.0.1:8791";
const CELL_RULE_VALUES = 7776;
const { values: options } = parseArgs({
  options: {
    ticks: { type: "string", default: "600" },
    picture: { type: "string", multiple: true },
  },
});
const ticks = Number(options.ticks);
if (!Number.isInteger(ticks) || ticks < 0) throw new Error("Ticks must be a nonnegative integer.");
const selectedIds = options.picture?.map(Number);
if (selectedIds?.some((id) => !RECORDED.some((picture) => picture.imageId === id))) {
  throw new Error("Select a recorded picture's library image ID.");
}
const pictures = RECORDED.filter((picture) => !selectedIds || selectedIds.includes(picture.imageId));
const output = fileURLToPath(new URL("../../app/public/how/recorded/", import.meta.url));

function decodeRule(encoded) {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== CELL_RULE_VALUES * 4) throw new Error(`a cell rule has ${CELL_RULE_VALUES} float32 values`);
  return new Float32Array(bytes.buffer, bytes.byteOffset, CELL_RULE_VALUES).slice();
}

async function recordGrid({ imageId, material }) {
  const file = await (await fetch(`${GALLERY}/api/materials/${material}/material.json`)).json();
  if (file.rule.layout !== "figure-16-96-torus-v1" || file.anchor.imageId !== imageId) throw new Error(`${material} is not a cell rule anchored on ${imageId}`);
  const rule = decodeRule(file.rule.values);
  const seed = file.reading.seed;
  const side = file.reading.side;
  if (side !== 64 && side !== 128) throw new Error(`${material} has an unsupported grid size: ${side}`);
  if (file.playback?.hiddenNoise) throw new Error(`${material} requires hidden-channel playback noise`);
  const startDisc = file.start?.kind === "centre-disc" ? file.start.radius : 0;
  let state = startState(side, seed, startDisc);
  const started = performance.now();
  for (let tick = 0; tick < ticks; tick++) state = referenceStep(state, rule, side, seed, tick, file.rule.fireRate);
  const header = Buffer.alloc(16);
  header.write("HGR1", 0, "latin1");
  header.writeUInt16LE(side, 4);
  header.writeUInt16LE(CHANNELS, 6);
  header.writeUInt32LE(ticks, 8);
  header.writeUInt32LE(seed, 12);
  const values = Buffer.from(Float16Array.from(state).buffer);
  await writeFile(`${output}picture-${imageId}/grid-${String(ticks).padStart(3, "0")}.bin`, Buffer.concat([header, values]));
  console.log(`${material}: ${ticks} ticks from seed ${seed} in ${((performance.now() - started) / 1000).toFixed(0)} s`);
}

for (const picture of pictures) await recordGrid(picture);
