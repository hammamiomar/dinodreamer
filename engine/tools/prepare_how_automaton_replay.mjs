// Replay the How page's automaton once on the CPU, with the player's own reference step, and
// record what the page's act 3 shows of it: the fine and coarse grids at the reading's tick, and
// the picture those grids make. The DINO reading of that picture is prepare_how_records.py's
// job (--picture-file); the training history is copied by prepare_how_automaton_history.py.
//
//   grid-fine-600.bin, grid-coarse-600.bin
//                  "HGR1", u16 side, u16 channels, u32 tick, u32 seed; f16 state[side·side·channels]
//                  (row-major cells, 16 channels each), as recorded.ts decodeGrid reads
//   picture-128.rgb  the picture of the two grids at that tick, 128 × 128 × 3 bytes, row-major:
//                  byte = round-half-even(255 · clamp(up(coarse_c) + fine_c + 0.5, 0, 1)) for c = 0, 1, 2;
//                  the Python step turns it into PNGs
//   replay.json    the definition, its seed, tick and fire rate, and the rule's SHA-256
//
//   node engine/tools/prepare_how_automaton_replay.mjs [--definition <url or path>] [--ticks 600] [--output <folder>]
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CHANNELS, COARSE_NOISE_KEY, NOISE_KEY, PYRAMID_RULE_VALUES, referencePyramidStep, startState, upsampleTorus } from "../../app/src/replay/figure-reference.ts";

const DEFINITION = "http://127.0.0.1:5240/api/materials/block-4009-figure-pyramid-strongest-seed-0/material.json";
const { values: options } = parseArgs({
  options: {
    definition: { type: "string", default: DEFINITION },
    ticks: { type: "string", default: "600" },
    output: { type: "string", default: fileURLToPath(new URL("../../app/public/how/training/automaton-4009/", import.meta.url)) },
  },
});
const ticks = Number(options.ticks);
if (!Number.isInteger(ticks) || ticks < 0) throw new Error("Ticks must be a nonnegative integer.");

const text = options.definition.startsWith("http") ? await (await fetch(options.definition)).text() : await readFile(options.definition, "utf8");
const file = JSON.parse(text);
if (file.rule.layout !== "figure-pyramid-16-96-torus-v1") throw new Error(`${file.id} is not a two-scale rule.`);
if (file.start?.kind === "centre-disc") throw new Error("A seeded start is not handled here.");
const bytes = Buffer.from(file.rule.values, "base64");
if (bytes.length !== PYRAMID_RULE_VALUES * 4) throw new Error(`a two-scale rule has ${PYRAMID_RULE_VALUES} float32 values`);
const rule = new Float32Array(bytes.buffer, bytes.byteOffset, PYRAMID_RULE_VALUES).slice();
const side = file.reading.side;
const seed = file.reading.seed;
const fireRate = file.rule.fireRate;

let fine = startState(side, seed, 0, NOISE_KEY);
let coarse = startState(side / 2, seed, 0, COARSE_NOISE_KEY);
const started = performance.now();
for (let tick = 0; tick < ticks; tick++) {
  ({ fine, coarse } = referencePyramidStep(fine, coarse, rule, side, seed, tick, fireRate));
  if (tick % 100 === 99) console.log(`tick ${tick + 1} of ${ticks}, ${((performance.now() - started) / 1000).toFixed(0)} s`);
}

function grid(state, gridSide) {
  const header = Buffer.alloc(16);
  header.write("HGR1", 0, "latin1");
  header.writeUInt16LE(gridSide, 4);
  header.writeUInt16LE(CHANNELS, 6);
  header.writeUInt32LE(ticks, 8);
  header.writeUInt32LE(seed, 12);
  return Buffer.concat([header, Buffer.from(Float16Array.from(state).buffer)]);
}

/** round-half-even(255 · clamp(v, 0, 1)) as a byte. */
function byteOf(value) {
  const scaled = 255 * Math.min(1, Math.max(0, value));
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const picture = Buffer.alloc(side * side * 3);
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    for (let channel = 0; channel < 3; channel++) {
      const value = upsampleTorus(coarse, side / 2, x, y, channel) + fine[(y * side + x) * CHANNELS + channel] + 0.5;
      picture[(y * side + x) * 3 + channel] = byteOf(value);
    }
  }
}

await mkdir(options.output, { recursive: true });
await writeFile(`${options.output}/grid-fine-${String(ticks).padStart(3, "0")}.bin`, grid(fine, side));
await writeFile(`${options.output}/grid-coarse-${String(ticks).padStart(3, "0")}.bin`, grid(coarse, side / 2));
await writeFile(`${options.output}/picture-${side}.rgb`, picture);
await writeFile(`${options.output}/replay.json`, JSON.stringify({
  definition: file.id,
  block: file.block,
  layout: file.rule.layout,
  side,
  coarseSide: side / 2,
  seed,
  tick: ticks,
  fireRate,
  ruleSha256: createHash("sha256").update(bytes).digest("hex"),
  anchor: file.anchor,
  medianNorm: file.recipe.settings.medianNorm,
  reading: file.reading,
  training: file.training,
  replayed: new Date().toISOString().slice(0, 10),
}, null, 2) + "\n");
console.log(`${file.id}: ${ticks} ticks from seed ${seed} in ${((performance.now() - started) / 1000).toFixed(0)} s, written to ${options.output}`);
