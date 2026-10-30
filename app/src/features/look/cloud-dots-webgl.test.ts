import { afterEach, expect, it, vi } from "vitest";
import { projector, type Vec3, type View } from "../../ui/code-space/projection";
import { createDotLayer, dotUniforms, shaderDotCentre } from "./cloud-dots-webgl";

it("puts each dot where the Canvas 2D layer does, after a pan and a zoom, at any device ratio", () => {
  // An odd CSS width at ratio 1.5 makes a fractional canvas size: 991 × 1.5 = 1,486.5 device pixels.
  const view: View = { fit: { center: [3, -1, 2], radius: 21 }, orbit: { yaw: -0.48, pitch: 0.3, zoom: 7.2 }, width: 991, height: 510 };
  const codes: Vec3[] = [[0, 0, 0], [17.5, 1.2, -0.4], [-6, 9, 3], [3, -1, 2]];
  for (const ratio of [1, 1.5, 2]) {
    const uniforms = dotUniforms(view, ratio);
    for (const code of codes) {
      const css = projector(view)(code);
      const shader = shaderDotCentre(uniforms, code);
      // The layer draws at CSS position × ratio, y down; the shader counts y up from the bottom of its whole-pixel canvas.
      expect(shader.x).toBeCloseTo(css.x * ratio, 9);
      expect(shader.y).toBeCloseTo(uniforms.viewport[1] - css.y * ratio, 9);
    }
  }
});

function dotCanvas(linked = true) {
  const shaders = [{}, {}];
  const buffers = [{}, {}, {}];
  const program = {};
  let shaderIndex = 0;
  let bufferIndex = 0;
  const gl = {
    createShader: () => shaders[shaderIndex++],
    createProgram: () => program,
    createBuffer: () => buffers[bufferIndex++],
    getProgramParameter: () => linked,
    getProgramInfoLog: () => "unsupported program",
    getAttribLocation: () => 0,
    getUniformLocation: () => null,
    isContextLost: () => false,
    deleteShader: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
  };
  const context = new Proxy(gl, {
    get(target, key) { return Reflect.get(target, key) ?? (() => {}); },
  });
  const canvas = Object.assign(new EventTarget(), { getContext: () => context });
  vi.stubGlobal("location", { search: "" });
  return { canvas: canvas as unknown as HTMLCanvasElement, gl, shaders, buffers, program };
}

afterEach(() => vi.unstubAllGlobals());

it("releases every GPU allocation when the plot is removed", () => {
  const { canvas, gl, shaders, buffers, program } = dotCanvas();
  const changed = vi.fn();
  const layer = createDotLayer(canvas, changed)!;
  layer.dispose();
  expect(gl.deleteShader.mock.calls.map(([shader]) => shader)).toEqual(shaders);
  expect(gl.deleteBuffer.mock.calls.map(([buffer]) => buffer)).toEqual(buffers);
  expect(gl.deleteProgram).toHaveBeenCalledExactlyOnceWith(program);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  expect(changed).not.toHaveBeenCalled();
});

it("releases the rejected program and its shaders before using Canvas 2D", () => {
  const { canvas, gl, shaders, program } = dotCanvas(false);
  expect(createDotLayer(canvas, () => {})).toBeNull();
  expect(gl.deleteShader.mock.calls.map(([shader]) => shader)).toEqual(shaders);
  expect(gl.deleteProgram).toHaveBeenCalledExactlyOnceWith(program);
});
