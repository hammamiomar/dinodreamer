import { figurePlayback, readFigureMaterial } from "../src/materials/material-file";
import { shadertoyShaderSource } from "../src/replay/shadertoy-export";
import { createFigureReplay } from "../src/replay/figure-replay";
import { FIGURE_SHADERS } from "../src/replay/figure-shaders";

const VERTEX = `#version 300 es
void main() {
  vec2 point = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(point * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Shadertoy runs A to D in order. Earlier inputs are current; self/later inputs are previous. */
function createShadertoyHarness(source: string, side: number, pictureSide: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 2 * side;
  canvas.height = pictureSide;
  document.body.append(canvas);
  const context = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
  if (!context) throw new Error("WebGL2 is unavailable.");
  const gl = context;
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("RGBA32F render targets are unavailable.");
  const information = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = information ? gl.getParameter(information.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  if (!String(renderer).includes("SwiftShader")) throw new Error(`Expected CPU SwiftShader, got ${renderer}`);
  const parts = source.split(/\/\/ ===== (?:Common|Buffer [ABCD]|Image) =====\n/).slice(1);
  if (parts.length !== 6) throw new Error("The export must contain six sections.");
  const compile = (type: number, code: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compilation failed.");
    return shader;
  };
  const started = performance.now();
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const programs = parts.slice(1).map((part) => {
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec3 iResolution;
uniform int iFrame;
uniform float iTime;
uniform sampler2D iChannel0, iChannel1, iChannel2, iChannel3;
out vec4 outputColor;
${parts[0]}\n${part}
void main() { mainImage(outputColor, gl_FragCoord.xy); }`);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Shader linking failed.");
    gl.deleteShader(fragment);
    return program;
  });
  gl.deleteShader(vertex);
  const compileMs = performance.now() - started;
  const targets = Array.from({ length: 4 }, () => [0, 1].map(() => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, canvas.width, canvas.height);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Incomplete float framebuffer.");
    return { texture, framebuffer };
  }));
  const current = [0, 0, 0, 0];
  let frame = -1;
  const draw = (pass: number) => {
    const program = programs[pass];
    gl.useProgram(program);
    gl.uniform3f(gl.getUniformLocation(program, "iResolution"), canvas.width, canvas.height, 1);
    gl.uniform1i(gl.getUniformLocation(program, "iFrame"), frame);
    gl.uniform1f(gl.getUniformLocation(program, "iTime"), frame / 60);
    for (let input = 0; input < 4; input++) {
      gl.activeTexture(gl.TEXTURE0 + input);
      gl.bindTexture(gl.TEXTURE_2D, targets[input][current[input]].texture);
      gl.uniform1i(gl.getUniformLocation(program, `iChannel${input}`), input);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const advance = () => {
    frame++;
    for (let pass = 0; pass < 4; pass++) {
      const destination = 1 - current[pass];
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[pass][destination].framebuffer);
      draw(pass);
      current[pass] = destination;
    }
  };
  const state = () => {
    const result = new Float32Array(side * side * 16);
    const pixels = new Float32Array(side * side * 4);
    for (let group = 0; group < 4; group++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[group][current[group]].framebuffer);
      gl.readPixels((frame % 2) * side, 0, side, side, gl.RGBA, gl.FLOAT, pixels);
      for (let cell = 0; cell < side * side; cell++) {
        result.set(pixels.subarray(cell * 4, cell * 4 + 4), cell * 16 + group * 4);
      }
    }
    if (gl.getError() !== gl.NO_ERROR) throw new Error("State readback failed.");
    return result;
  };
  const picture = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    draw(4);
    const pixels = new Uint8Array(pictureSide * pictureSide * 4);
    gl.readPixels((canvas.width - pictureSide) / 2, 0, pictureSide, pictureSide, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const result = new Uint8Array(pixels.length);
    for (let row = 0; row < pictureSide; row++) {
      result.set(pixels.subarray(row * pictureSide * 4, (row + 1) * pictureSide * 4), (pictureSide - row - 1) * pictureSide * 4);
    }
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Image readback failed.");
    return result;
  };
  return { advance, state, picture, compileMs, renderer, dispose: () => {
    targets.flat().forEach(({ texture, framebuffer }) => { gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer); });
    programs.forEach((program) => gl.deleteProgram(program));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
  } };
}

function difference(first: ArrayLike<number>, second: ArrayLike<number>, rgbOnly = false) {
  if (first.length !== second.length) throw new Error("Mismatched comparison lengths.");
  let sum = 0;
  let maximum = 0;
  let count = 0;
  for (let index = 0; index < first.length; index++) {
    if (rgbOnly && index % 4 === 3) continue;
    const error = Math.abs(first[index] - second[index]);
    if (!Number.isFinite(error)) throw new Error("Non-finite simulation state.");
    sum += error;
    maximum = Math.max(maximum, error);
    count++;
  }
  return { meanAbsolute: sum / count, maximumAbsolute: maximum };
}

async function qualifyMaterial(value: unknown, steps = 600) {
  const material = readFigureMaterial(value);
  const { file, values } = material;
  const playback = figurePlayback(file);
  const side = file.reading.side;
  const pictureSide = side * playback.pixelsPerCell;
  const source = shadertoyShaderSource(file, values);
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU is unavailable.");
  const adapterInfo = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
  if (!`${adapterInfo.architecture} ${adapterInfo.description}`.toLowerCase().includes("swiftshader")) {
    throw new Error(`Expected CPU WebGPU, got ${JSON.stringify(adapterInfo)}`);
  }
  const device = await adapter.requestDevice();
  const replay = await createFigureReplay({ side, seed: file.reading.seed, ...playback, device },
    { values, fireRate: file.rule.fireRate }, FIGURE_SHADERS);
  let harness: ReturnType<typeof createShadertoyHarness> | undefined;
  try {
    harness = createShadertoyHarness(source, side, pictureSide);
    console.log(`${file.id}: compiled in ${harness.compileMs.toFixed(1)} ms`);
    const started = performance.now();
    harness.advance();
    const initialState = difference(harness.state(), await replay.readState());
    const initialPicture = difference(harness.picture(), await replay.readPixels(), true);
    const initializationMs = performance.now() - started;
    if (initialState.maximumAbsolute !== 0) throw new Error(`Initialization differs: ${JSON.stringify(initialState)}`);
    const earlySteps = [];
    const simulationStarted = performance.now();
    for (let step = 1; step <= steps; step++) {
      harness.advance();
      await replay.advance(1);
      if (step <= 2) {
        const error = difference(harness.state(), await replay.readState());
        earlySteps.push({ step, ...error });
        if (error.maximumAbsolute > 0.0001) throw new Error(`Step ${step} differs: ${JSON.stringify(error)}`);
      }
      if (step % 100 === 0) console.log(`${file.id}: step ${step}, ${((performance.now() - simulationStarted) / 1000).toFixed(1)} s`);
    }
    const webglPixels = harness.picture();
    const webgpuPixels = await replay.readPixels();
    const simulationMs = performance.now() - simulationStarted;
    return {
      id: file.id, seed: file.reading.seed, side, pictureSide, steps, playback,
      renderer: harness.renderer, adapterInfo, compileMs: harness.compileMs, initializationMs, simulationMs,
      initialState, initialPicture, earlySteps,
      finalState: difference(harness.state(), await replay.readState()),
      pixels: difference(webglPixels, webgpuPixels, true),
      webglPixels: [...webglPixels], webgpuPixels: [...webgpuPixels], source,
    };
  } finally {
    harness?.dispose();
    replay.dispose();
    device.destroy();
  }
}

Object.assign(window, { qualifyMaterial });
