import { figurePlayback, FIGURE_PYRAMID_LAYOUT, replayGridSides, type FigureMaterialFile } from "../materials/material-file";
import { FIGURE_WGSL } from "./figure-shaders";

interface WeightArray { name: string; offset: number; length: number; note: string }
/** fc1.weight, fc1.bias and fc2.weight in the figure layout's flat order. */
const CELL_ARRAYS: WeightArray[] = [
  { name: "W1", offset: 0, length: 6144, note: "fc1.weight [96, 64], row-major; perception index 4c + k" },
  { name: "B1", offset: 6144, length: 96, note: "fc1.bias [96]" },
  { name: "W2", offset: 6240, length: 1536, note: "fc2.weight [16, 96], row-major" },
];
/** The pyramid's coarse rule (the figure layout), then its fine rule. */
const { w1: FINE_W1, b1: FINE_B1, w2: FINE_W2 } = FIGURE_WGSL.pyramidFine;
const PYRAMID_ARRAYS: WeightArray[] = [
  { name: "W1C", offset: 0, length: 6144, note: "coarse fc1.weight [96, 64], row-major; perception index 4c + k" },
  { name: "B1C", offset: 6144, length: 96, note: "coarse fc1.bias [96]" },
  { name: "W2C", offset: 6240, length: 1536, note: "coarse fc2.weight [16, 96], row-major" },
  { name: "W1F", offset: FINE_W1, length: 7680, note: "fine fc1.weight [96, 80], row-major; inputs 0-63 perception 4c + k, 64-79 the upsampled coarse state" },
  { name: "B1F", offset: FINE_B1, length: 96, note: "fine fc1.bias [96]" },
  { name: "W2F", offset: FINE_W2, length: 1536, note: "fine fc2.weight [16, 96], row-major" },
];
const PER_LINE = 8;

/** Nine significant digits give back every float32 exactly. */
export function wgslFloat(value: number): string {
  return Math.fround(value).toPrecision(9);
}

function constantArray(values: Float32Array, name: string, offset: number, length: number): string {
  const lines: string[] = [];
  for (let start = 0; start < length; start += PER_LINE) {
    const row = Array.from(values.subarray(offset + start, offset + Math.min(start + PER_LINE, length)), wgslFloat);
    lines.push(`  ${row.join(", ")},`);
  }
  return `const ${name} = array<f32, ${length}>(\n${lines.join("\n")}\n);`;
}

function weightConstants(values: Float32Array, arrays: WeightArray[]): string {
  return arrays.map(({ name, offset, length, note }) => `// ${note}\n${constantArray(values, name, offset, length)}`).join("\n\n");
}

/**
 * The step's weight accessors (figure-shaders.ts stepSource) over the constant arrays, which keep the
 * weights in their own layout: fc1.weight [96, inputs] and fc2.weight [16, 96], row-major. `_w1(unit, q)`
 * is fc1.weight[unit, 4q..4q+3], `_b1(unit)` fc1.bias[unit], `_w2(unit, k)` fc2.weight[4k..4k+3, unit].
 */
function quadAccessors(prefix: "rule" | "fine", w1: string, b1: string, w2: string, inputs: 64 | 80): string {
  return `fn ${prefix}_w1(unit_index: u32, q: u32) -> vec4<f32> {
  let i = unit_index * ${inputs}u + 4u * q;
  return vec4<f32>(${w1}[i], ${w1}[i + 1u], ${w1}[i + 2u], ${w1}[i + 3u]);
}
fn ${prefix}_b1(unit_index: u32) -> f32 { return ${b1}[unit_index]; }
fn ${prefix}_w2(unit_index: u32, k: u32) -> vec4<f32> {
  let i = 4u * k * 96u + unit_index;
  return vec4<f32>(${w2}[i], ${w2}[i + 96u], ${w2}[i + 192u], ${w2}[i + 288u]);
}`;
}

function materialLines(file: FigureMaterialFile): string {
  return `// ${file.name}: DinoDreamer cellular automaton, a shader with its weights embedded.
// Generated from the automaton definition ${file.id}.material.json; edit the definition, not this file.
// Basis group ${file.block} · training procedure ${file.recipe.name} · layout ${file.rule.layout} · cell update probability ${file.rule.fireRate}
// Training procedure source ${file.recipe.source}, SHA-256 ${file.recipe.sourceSha256}; trainer commit ${file.trainerCommit}.`;
}

/**
 * One WGSL file that runs this material, with its weights written in as constants: 7,776 for a cell
 * rule, 17,088 for the pyramid. It is an export for other WebGPU projects; the site plays materials
 * with the data-driven runtime. It is made from the weights alone, so no uploaded shader source ever
 * runs in a visitor's browser.
 */
export function embeddedRuleShaderSource(file: FigureMaterialFile, values: Float32Array): string {
  if (file.rule.layout === FIGURE_PYRAMID_LAYOUT) return embeddedPyramidShaderSource(file, values);
  if (values.length !== 7776) throw new Error("A single-scale cellular model has 7,776 values.");
  const { hiddenNoise: sigma, startDisc, startBackground, pixelsPerCell } = figurePlayback(file);
  const sides = replayGridSides(file).join(" or ");
  const display = pixelsPerCell === 2
    ? `//   Display: this automaton's picture has 2 pixels per cell (2 * side wide): the bilinear upsampling (torch
//            F.interpolate, align_corners false, edges clamped) of clamp(x[c] + 0.5, 0, 1) for c = 0, 1, 2 (red,
//            green, blue), then byte = round-half-even(255 * value).`
    : "//   Display: byte = round-half-even(255 * clamp(x[c] + 0.5, 0, 1)) for c = 0, 1, 2 (red, green, blue).";
  const start = startDisc > 0
    ? `//   Start: x[i] = unit(pcg(pcg(seed ^ 0x6e6f6973) + i)) - 0.5 inside the seeded disc, START_BACKGROUND times it
//          outside (0 when START_BACKGROUND is 0): cell (x, y) is inside when
//          (x - side/2 + 0.5)^2 + (y - side/2 + 0.5)^2 <= START_DISC^2 (START_DISC = ${startDisc} cells).`
    : "//   Start: x[i] = unit(pcg(pcg(seed ^ 0x6e6f6973) + i)) - 0.5, uniform on [-0.5, 0.5).";
  const header = `${materialLines(file)}
//
// Replay contract:
//   State: side * side * 16 float32 values, cells row-major, 16 channels last, bound as array<vec4<f32>>
//          (four vec4 per cell, channels 4k to 4k + 3). side is ${sides}.
${start}
//   Cell update: cell n updates at simulation step t when unit(pcg(pcg(pcg(seed ^ 0x66697265) + t) + n))
//         < FIRE_RATE, the cell update probability.
//   Step: on a torus, per channel c: identity, Sobel x / 8, Sobel y / 8, nine-point Laplacian / 16 at
//         index 4c + k; h = relu(W1 p + B1); an updating cell becomes x + W2 h, any other cell keeps x.
//   pcg is the PCG hash of Jarzynski and Olano (2020) on u32; unit(h) = (h >> 8) / 2^24.
${display}
//
// Host notes (WebGPU):
//   1. Make two storage buffers of side * side * 16 * 4 bytes, A and B, and one 16-byte uniform buffer
//      holding Grid { side: u32, seed: u32, tick: u32, unused: u32 }.
//   2. Make two compute pipelines from this module with layout "auto": entry points start_state and
//      step_cell. Bind group 0 of each: binding 0 = the current state (step_cell only), binding 1 = the
//      buffer to write, binding 2 = the uniform.
//   3. Start: write Grid { side, seed, 0, 0 }; dispatch start_state with ceil(side * side * 4 / 64)
//      workgroups writing A. A is the current state at simulation step 0.
//   4. Simulation step t (0, 1, 2, ...): write Grid { side, seed, t, 0 }; dispatch step_cell with ceil(side * side / 64)
//      workgroups from the current state into the other buffer; that buffer becomes the current state.
//      A uniform write applies to the next submission, so submit once per simulation step.
//   5. Draw the current state with the display rule, one pixel per cell or scaled.
`;
  return `${header}
const FIRE_RATE: f32 = ${wgslFloat(file.rule.fireRate)};
const HIDDEN_NOISE: f32 = ${wgslFloat(sigma)}; // reserved playback noise; 0 is E18's playback
const START_DISC: f32 = ${wgslFloat(startDisc)}; // seeded start radius in cells; 0 starts from noise everywhere
const START_BACKGROUND: f32 = ${wgslFloat(startBackground)}; // the start draw's amplitude outside the disc; 0 is zero there
${FIGURE_WGSL.hash}${FIGURE_WGSL.start}
struct Grid { side: u32, seed: u32, tick: u32, unused: u32 }
@group(0) @binding(0) var<storage, read> state: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> next: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> grid: Grid;
${quadAccessors("rule", "W1", "B1", "W2", 64)}
fn rule_fire_key() -> u32 { return FIRE_KEY; }
fn rule_fire_rate() -> f32 { return FIRE_RATE; }
fn playback_hidden_noise() -> f32 { return HIDDEN_NOISE; }

@compute @workgroup_size(64)
fn start_state(@builtin(global_invocation_id) id: vec3<u32>) {
  let quad = id.x;
  if (quad >= grid.side * grid.side * 4u) { return; }
  let key = pcg(grid.seed ^ NOISE_KEY);
  let index = 4u * quad;
  next[quad] = vec4<f32>(start_value(index, grid.side, key, START_DISC, START_BACKGROUND),
    start_value(index + 1u, grid.side, key, START_DISC, START_BACKGROUND),
    start_value(index + 2u, grid.side, key, START_DISC, START_BACKGROUND),
    start_value(index + 3u, grid.side, key, START_DISC, START_BACKGROUND));
}
${FIGURE_WGSL.step}
${FIGURE_WGSL.hidden}

${weightConstants(values, CELL_ARRAYS)}
`;
}

/** The pyramid's embedded-rule file: both grids, both rules and the torus upsampling, with host notes for two grids. */
function embeddedPyramidShaderSource(file: FigureMaterialFile, values: Float32Array): string {
  if (values.length !== 17088) throw new Error("A two-scale cellular model has 17,088 values.");
  const { startDisc, startBackground } = figurePlayback(file);
  const start = startDisc > 0
    ? `//   Start: central noise initialization, as for a single-scale cellular model, inside the seeded disc, and
//          START_BACKGROUND times it outside: START_DISC = ${startDisc} fine cells, half that in coarse cells.`
    : "//   Start: x[i] = unit(pcg(pcg(seed ^ KEY) + i)) - 0.5, KEY = 0x6e6f6973 for the fine grid and 0x636e6f69 for the coarse grid.";
  const header = `${materialLines(file)}
//
// Replay contract of the two-scale cellular model:
//   Two grids, each n * n * 16 float32 values, cells row-major, 16 channels last, bound as array<vec4<f32>>
//   (four vec4 per cell): the fine grid (n = side, 128 or 256) and the coarse grid (n = side / 2).
${start}
//   Cell update: cell c of a grid updates at simulation step t when unit(pcg(pcg(pcg(seed ^ KEY) + t) + c))
//         < FIRE_RATE, the cell update probability; KEY = 0x66697265 for the fine grid and 0x63666972 for the
//         coarse grid.
//   Simulation step: the coarse grid steps first with W1C, B1C and W2C, exactly as a single-scale cellular
//         model. Then the fine grid steps:
//         its inputs are its own perception (64, index 4c + k) and the new coarse state upsampled on the torus
//         (16): fine cell j reads coarse position j/2 - 0.25 per axis with wrap, weights 0.25/0.75 or 0.75/0.25.
//         h = relu(W1F p + B1F); an updating fine cell becomes x + W2F h.
//   pcg is the PCG hash of Jarzynski and Olano (2020) on u32; unit(h) = (h >> 8) / 2^24.
//   Display: byte = round-half-even(255 * clamp(up(coarse[c]) + fine[c] + 0.5, 0, 1)) for c = 0, 1, 2, one
//            pixel per fine cell, with up() the same torus upsampling.
//
// Host notes (WebGPU):
//   1. Make storage buffers A and B of side * side * 16 * 4 bytes (fine), CA and CB of a quarter of that
//      (coarse), and two 16-byte uniform buffers: fine Grid { side, seed, tick, 0 } and coarse Grid
//      { side / 2, seed, tick, 1 }, each Grid { side: u32, seed: u32, tick: u32, coarse: u32 }.
//   2. Make three compute pipelines from this module with layout "auto": start_state, step_cell (the coarse
//      grid) and step_fine. Bind group 0: binding 0 = the current state of the grid that steps (not for
//      start_state), binding 1 = the buffer to write, binding 2 = that grid's uniform, binding 3 = the coarse
//      buffer that step_cell has just written (step_fine only).
//   3. Start: write both uniforms with tick 0; dispatch start_state into CA with the coarse uniform
//      (ceil((side / 2)^2 * 4 / 64) workgroups) and into A with the fine uniform (ceil(side^2 * 4 / 64)).
//   4. Simulation step t: write both uniforms with tick t; dispatch step_cell from the current coarse buffer into the
//      other one (ceil((side / 2)^2 / 64) workgroups), then step_fine from the current fine buffer into the
//      other one, reading the new coarse buffer (ceil(side^2 / 64)). Swap both pairs. Submit once per simulation step.
//   5. Draw with the display rule; it needs both current buffers.
`;
  return `${header}
const FIRE_RATE: f32 = ${wgslFloat(file.rule.fireRate)};
const HIDDEN_NOISE: f32 = 0.00000000; // the pyramid has no playback noise
const START_DISC: f32 = ${wgslFloat(startDisc)}; // seeded start radius in fine cells; 0 starts from noise everywhere
const START_BACKGROUND: f32 = ${wgslFloat(startBackground)}; // the start draw's amplitude outside the disc; 0 is zero there
${FIGURE_WGSL.hash}${FIGURE_WGSL.start}${FIGURE_WGSL.torus}
struct Grid { side: u32, seed: u32, tick: u32, coarse: u32 }
@group(0) @binding(0) var<storage, read> state: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> next: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> grid: Grid;
@group(0) @binding(3) var<storage, read> coarse: array<vec4<f32>>;
${quadAccessors("rule", "W1C", "B1C", "W2C", 64)}
fn rule_fire_key() -> u32 { return COARSE_FIRE_KEY; }
${quadAccessors("fine", "W1F", "B1F", "W2F", 80)}
fn fine_fire_key() -> u32 { return FIRE_KEY; }
fn rule_fire_rate() -> f32 { return FIRE_RATE; }
fn playback_hidden_noise() -> f32 { return HIDDEN_NOISE; }

@compute @workgroup_size(64)
fn start_state(@builtin(global_invocation_id) id: vec3<u32>) {
  let quad = id.x;
  if (quad >= grid.side * grid.side * 4u) { return; }
  let key = pcg(grid.seed ^ select(NOISE_KEY, COARSE_NOISE_KEY, grid.coarse == 1u));
  let disc = START_DISC / f32(1u + grid.coarse);
  let index = 4u * quad;
  next[quad] = vec4<f32>(start_value(index, grid.side, key, disc, START_BACKGROUND),
    start_value(index + 1u, grid.side, key, disc, START_BACKGROUND),
    start_value(index + 2u, grid.side, key, disc, START_BACKGROUND),
    start_value(index + 3u, grid.side, key, disc, START_BACKGROUND));
}
${FIGURE_WGSL.step}
${FIGURE_WGSL.fineStep}
${FIGURE_WGSL.hidden}

${weightConstants(values, PYRAMID_ARRAYS)}
`;
}

export function embeddedRuleShaderName(file: FigureMaterialFile): string {
  return `${file.id}.wgsl`;
}
