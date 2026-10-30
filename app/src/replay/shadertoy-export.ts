import { figurePlayback, FIGURE_LAYOUT, type FigureMaterialFile } from "../materials/material-file";

export interface ShadertoySections {
  common: string;
  buffers: [string, string, string, string];
  image: string;
}

/** The pyramid needs a separate coarse/fine phase and is not qualified for this export. */
export function supportsShadertoy(file: FigureMaterialFile): boolean {
  return file.rule.layout === FIGURE_LAYOUT;
}

/** Nine significant digits preserve every finite float32 weight. */
function floatLiteral(value: number): string {
  return Math.fround(value).toPrecision(9);
}

function constantArray(name: string, values: Float32Array): string {
  const rows: string[] = [];
  for (let start = 0; start < values.length; start += 8) {
    rows.push(Array.from(values.subarray(start, start + 8), floatLiteral).join(", "));
  }
  return `const float ${name}[${values.length}] = float[${values.length}](\n  ${rows.join(",\n  ")}\n);`;
}

const HASH = `
uint pcg(uint value) {
  uint state = value * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float unit(uint hash) { return float(hash >> 8u) / 16777216.0; }
`;

const READ_STATE = `
vec4 stateGroup(ivec2 cell, int group, int bank) {
  ivec2 address = (cell + GRID_SIDE) % GRID_SIDE + ivec2(bank * GRID_SIDE, 0);
  if (group == 0) return texelFetch(iChannel0, address, 0);
  if (group == 1) return texelFetch(iChannel1, address, 0);
  if (group == 2) return texelFetch(iChannel2, address, 0);
  return texelFetch(iChannel3, address, 0);
}
`;

/** Each pass preserves the source bank, including in buffers already written this frame. */
function bufferSource(group: number): string {
  return `const int OUTPUT_GROUP = ${group};
${READ_STATE}
void mainImage(out vec4 color, in vec2 fragment) {
  ivec2 address = ivec2(fragment);
  color = vec4(0.0);
  if (address.x >= 2 * GRID_SIDE || address.y >= GRID_SIDE) return;
  ivec2 cell = ivec2(address.x % GRID_SIDE, address.y);
  uint cellIndex = uint(cell.y * GRID_SIDE + cell.x);
  if (iFrame == 0) {
    vec2 offset = vec2(cell) - float(GRID_SIDE) / 2.0 + 0.5;
    if (START_DISC > 0.0 && dot(offset, offset) > START_DISC * START_DISC) return;
    uint key = pcg(SEED ^ 0x6e6f6973u);
    for (int component = 0; component < 4; component++) {
      color[component] = unit(pcg(key + cellIndex * 16u + uint(OUTPUT_GROUP * 4 + component))) - 0.5;
    }
    return;
  }
  int destinationBank = iFrame % 2;
  int sourceBank = 1 - destinationBank;
  color = stateGroup(cell, OUTPUT_GROUP, sourceBank);
  if (address.x / GRID_SIDE != destinationBank) return;
  uint tick = uint(iFrame - 1);
  bool fires = unit(pcg(pcg(pcg(SEED ^ 0x66697265u) + tick) + cellIndex)) < FIRE_RATE;
  if (fires) {
    float perception[64];
    for (int group = 0; group < 4; group++) {
      vec4 nw = stateGroup(cell + ivec2(-1, -1), group, sourceBank);
      vec4 n = stateGroup(cell + ivec2(0, -1), group, sourceBank);
      vec4 ne = stateGroup(cell + ivec2(1, -1), group, sourceBank);
      vec4 w = stateGroup(cell + ivec2(-1, 0), group, sourceBank);
      vec4 centre = stateGroup(cell, group, sourceBank);
      vec4 e = stateGroup(cell + ivec2(1, 0), group, sourceBank);
      vec4 sw = stateGroup(cell + ivec2(-1, 1), group, sourceBank);
      vec4 s = stateGroup(cell + ivec2(0, 1), group, sourceBank);
      vec4 se = stateGroup(cell + ivec2(1, 1), group, sourceBank);
      vec4 horizontal = ((ne + 2.0 * e + se) - (nw + 2.0 * w + sw)) / 8.0;
      vec4 vertical = ((sw + 2.0 * s + se) - (nw + 2.0 * n + ne)) / 8.0;
      vec4 laplacian = ((nw + 2.0 * n + ne + 2.0 * w + 2.0 * e + sw + 2.0 * s + se) - 12.0 * centre) / 16.0;
      for (int component = 0; component < 4; component++) {
        int index = (group * 4 + component) * 4;
        perception[index] = centre[component];
        perception[index + 1] = horizontal[component];
        perception[index + 2] = vertical[component];
        perception[index + 3] = laplacian[component];
      }
    }
    vec4 delta = vec4(0.0);
    for (int hiddenIndex = 0; hiddenIndex < 96; hiddenIndex++) {
      float hidden = B1[hiddenIndex];
      for (int inputIndex = 0; inputIndex < 64; inputIndex++) {
        hidden += W1[hiddenIndex * 64 + inputIndex] * perception[inputIndex];
      }
      if (hidden > 0.0) {
        for (int component = 0; component < 4; component++) {
          delta[component] += W2[(OUTPUT_GROUP * 4 + component) * 96 + hiddenIndex] * hidden;
        }
      }
    }
    color += delta;
  }
  if (HIDDEN_NOISE > 0.0) {
    uint key = pcg(pcg(SEED ^ 0x6869646eu) + tick);
    for (int component = 0; component < 4; component++) {
      int channel = OUTPUT_GROUP * 4 + component;
      if (channel < 3) continue;
      uint index = 2u * (cellIndex * 16u + uint(channel));
      float radius = sqrt(-2.0 * log(1.0 - unit(pcg(key + index))));
      color[component] += HIDDEN_NOISE * radius * cos(6.283185307 * unit(pcg(key + index + 1u)));
    }
  }
}
`;
}

const IMAGE = `
vec3 cellColor(ivec2 cell) {
  ivec2 address = cell + ivec2((iFrame % 2) * GRID_SIDE, 0);
  return clamp(texelFetch(iChannel0, address, 0).rgb + 0.5, 0.0, 1.0);
}
vec3 pictureColor(ivec2 pixel) {
  if (PICTURE_PIXELS == 1) return cellColor(pixel);
  vec2 source = max((vec2(pixel) + 0.5) / 2.0 - 0.5, 0.0);
  ivec2 lower = ivec2(source);
  ivec2 upper = min(lower + 1, GRID_SIDE - 1);
  vec2 weight = source - vec2(lower);
  vec3 top = cellColor(lower) * (1.0 - weight.x) + cellColor(ivec2(upper.x, lower.y)) * weight.x;
  vec3 bottom = cellColor(ivec2(lower.x, upper.y)) * (1.0 - weight.x) + cellColor(upper) * weight.x;
  return top * (1.0 - weight.y) + bottom * weight.y;
}
void mainImage(out vec4 color, in vec2 fragment) {
  color = vec4(0.0, 0.0, 0.0, 1.0);
  if (iResolution.x < float(2 * GRID_SIDE) || iResolution.y < float(GRID_SIDE * PICTURE_PIXELS)) return;
  int pictureSide = GRID_SIDE * PICTURE_PIXELS;
  int scale = max(1, int(min(iResolution.x, iResolution.y)) / pictureSide);
  ivec2 origin = (ivec2(iResolution.xy) - pictureSide * scale) / 2;
  ivec2 screen = ivec2(fragment) - origin;
  if (any(lessThan(screen, ivec2(0))) || any(greaterThanEqual(screen, ivec2(pictureSide * scale)))) return;
  ivec2 pixel = screen / scale;
  pixel.y = pictureSide - 1 - pixel.y;
  color = vec4(roundEven(pictureColor(pixel) * 255.0) / 255.0, 1.0);
}
`;

/** Generate code only from the accepted material data, never from stored shader text. */
export function shadertoySections(file: FigureMaterialFile, values: Float32Array): ShadertoySections {
  if (!supportsShadertoy(file)) throw new Error("The Shadertoy export does not yet support coarse + fine automata.");
  if (values.length !== 7776 || !values.every(Number.isFinite)) throw new Error("A single-grid rule needs 7,776 finite weights.");
  const { startDisc, pixelsPerCell, hiddenNoise } = figurePlayback(file);
  const common = `precision highp float;
precision highp int;
precision highp sampler2D;
const int GRID_SIDE = ${file.reading.side};
const uint SEED = ${file.reading.seed}u;
const float FIRE_RATE = ${floatLiteral(file.rule.fireRate)};
const float START_DISC = ${floatLiteral(startDisc)};
const float HIDDEN_NOISE = ${floatLiteral(hiddenNoise)};
const int PICTURE_PIXELS = ${pixelsPerCell};
${HASH}
// W1 [96, 64], B1 [96], W2 [16, 96], row-major.
${constantArray("W1", values.subarray(0, 6144))}
${constantArray("B1", values.subarray(6144, 6240))}
${constantArray("W2", values.subarray(6240))}
`;
  return { common, buffers: [bufferSource(0), bufferSource(1), bufferSource(2), bufferSource(3)], image: IMAGE };
}

export function shadertoyShaderSource(file: FigureMaterialFile, values: Float32Array): string {
  const { common, buffers, image } = shadertoySections(file, values);
  const minimumHeight = file.reading.side * figurePlayback(file).pixelsPerCell;
  const header = `// DinoDreamer Shadertoy export: ${file.id.replace(/[\r\n]/g, " ")}
// Trainer revision: ${file.trainerCommit.replace(/[\r\n]/g, " ")}
// This file contains six sections. Paste each section into its named tab.
// 1. Open https://www.shadertoy.com/new and add Common and Buffer A, B, C and D.
// 2. Replace each tab's code with its section below. Replace Image with the Image section.
// 3. In EACH Buffer tab, bind iChannel0 to Buffer A, iChannel1 to Buffer B,
//    iChannel2 to Buffer C and iChannel3 to Buffer D. Self-feedback is required.
// 4. In Image, bind iChannel0 to Buffer A. No other Image inputs are needed.
// 5. Set buffer inputs to nearest filtering, clamp wrapping and no vertical flip.
// 6. Use a canvas at least ${2 * file.reading.side} pixels wide and ${minimumHeight} pixels high.
// 7. Compile and reset the time to zero. Driver compilation can take tens of seconds.
// Reset after editing GRID_SIDE or SEED in Common, or after resizing the canvas.
// Frame 0 initializes the state. Frame 600 shows simulation step 600.
// The simulation takes one step per frame and does not depend on iTime.
// Each RGBA buffer stores four channels. Two horizontal regions preserve the
// same source state across Shadertoy's ordered A, B, C and D passes.
// The grid wraps as a torus. The Image pass centres the picture at whole-pixel scale.
// The export uses GLSL ES 3.0. Shadertoy supplies the version and uniform declarations.
`;
  return `${header}\n// ===== Common =====\n${common}\n${buffers.map((source, index) =>
    `// ===== Buffer ${"ABCD"[index]} =====\n${source}`).join("\n")}\n// ===== Image =====\n${image}`;
}

export function shadertoyShaderName(file: FigureMaterialFile): string {
  return `${file.id}.shadertoy.glsl`;
}
