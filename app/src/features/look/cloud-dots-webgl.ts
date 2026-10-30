import { viewScale, type Vec3, type View } from "../../ui/code-space/projection";

// WebGL2 batches the plain and selected dots into point draws, avoiding one Canvas
// call per dot. Shape, size, colour, alpha and depth order match cloud-drawing.ts,
// which provides the fallback when WebGL2 is unavailable or its context is lost.

/**
 * The projection as the vertex shader computes it, from the same View as projector():
 * a code minus the centre, turned by yaw then pitch and scaled. The Canvas 2D layer has
 * round(CSS size × ratio) pixels and draws at CSS position × ratio, unrounded; the
 * shader matches it in device pixels from the canvas's lower-left corner (WebGL's origin).
 */
export interface DotUniforms {
  center: Vec3;
  /** cos yaw, sin yaw, cos pitch, sin pitch. */
  rotation: [number, number, number, number];
  /** Device pixels per code unit. */
  scale: number;
  /** Half the CSS size, in device pixels: where the centre code lands. */
  half: [number, number];
  /** The canvas in whole device pixels. */
  viewport: [number, number];
}

export function dotUniforms(view: View, ratio: number): DotUniforms {
  const { yaw, pitch } = view.orbit;
  return {
    center: view.fit.center,
    rotation: [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)],
    scale: viewScale(view) * ratio,
    half: [(view.width * ratio) / 2, (view.height * ratio) / 2],
    viewport: [Math.round(view.width * ratio), Math.round(view.height * ratio)],
  };
}

/** Where the shader puts a dot's centre, in device pixels from the lower-left corner. The test compares it with projector(). */
export function shaderDotCentre(uniforms: DotUniforms, code: Vec3): { x: number; y: number } {
  const [cosYaw, sinYaw, cosPitch, sinPitch] = uniforms.rotation;
  const x = code[0] - uniforms.center[0];
  const y = code[1] - uniforms.center[1];
  const z = code[2] - uniforms.center[2];
  const turnedX = x * cosYaw + z * sinYaw;
  const turnedZ = -x * sinYaw + z * cosYaw;
  const turnedY = y * cosPitch - turnedZ * sinPitch;
  return { x: uniforms.half[0] + turnedX * uniforms.scale, y: uniforms.viewport[1] - uniforms.half[1] + turnedY * uniforms.scale };
}

const VERTEX = `#version 300 es
precision highp float;
in vec3 aCode;
in vec3 aColour;
uniform vec3 uCenter;
uniform vec4 uRotation;
uniform float uScale;
uniform vec2 uHalf;
uniform vec2 uViewport;
uniform float uSize;
out vec3 vColour;
out vec2 vCentre;
void main() {
  vec3 offset = aCode - uCenter;
  float turnedX = offset.x * uRotation.x + offset.z * uRotation.y;
  float turnedZ = -offset.x * uRotation.y + offset.z * uRotation.x;
  float turnedY = offset.y * uRotation.z - turnedZ * uRotation.w;
  vCentre = vec2(uHalf.x, uViewport.y - uHalf.y) + vec2(turnedX, turnedY) * uScale;
  gl_Position = vec4(2.0 * vCentre / uViewport - 1.0, 0.0, 1.0);
  // Two more pixels than the dot, so a dot between pixels keeps its partial edges.
  gl_PointSize = uSize + 2.0;
  vColour = aColour;
}`;

// Each pixel takes the part of it the dot covers, as Canvas 2D antialiases a fillRect or an
// arc: exactly for a square, by the distance to the edge for a round dot.
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColour;
in vec2 vCentre;
uniform float uSize;
uniform float uRound;
uniform float uAlpha;
uniform float uOneColour;
uniform vec3 uColour;
out vec4 colour;
void main() {
  float cover;
  if (uRound > 0.5) {
    cover = clamp(uSize / 2.0 + 0.5 - distance(gl_FragCoord.xy, vCentre), 0.0, 1.0);
  } else {
    vec2 half_ = vec2(uSize / 2.0);
    vec2 sides = clamp(min(gl_FragCoord.xy + 0.5, vCentre + half_) - max(gl_FragCoord.xy - 0.5, vCentre - half_), 0.0, 1.0);
    cover = sides.x * sides.y;
  }
  float alpha = uAlpha * cover;
  if (alpha <= 0.0) discard;
  vec3 rgb = uOneColour > 0.5 ? uColour : vColour;
  colour = vec4(rgb * alpha, alpha);
}`;

/** One draw call: dots of one shape and alpha, farthest first. */
export interface DotPass {
  order: Uint32Array;
  alpha: number;
  round: boolean;
  /** A square's side or a round dot's diameter, in CSS pixels. */
  size: number;
  /** One colour for every dot of the pass, or null for each dot's band colour. */
  colour: string | null;
}

export interface DotLayer {
  /** New codes or colours: uploaded once, not per view. */
  setDots(codes: readonly Vec3[], colours: readonly string[]): void;
  /** Clears the canvas and draws the passes in order. False when the context is lost: draw with Canvas 2D instead. */
  draw(view: View, ratio: number, passes: readonly DotPass[]): boolean;
  /** Releases the GPU resources and context listeners. */
  dispose(): void;
}

/** Any CSS colour (hex, oklch()) as sRGB bytes, as a canvas paints it. */
function colourBytes(colour: string, cache: Map<string, [number, number, number]>): [number, number, number] {
  let bytes = cache.get(colour);
  if (!bytes) {
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    context.canvas.width = context.canvas.height = 1;
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    bytes = [r!, g!, b!];
    cache.set(colour, bytes);
  }
  return bytes;
}

/** What the GPU holds for the dots; made at the start, and again when a lost context is restored. */
interface DotResources {
  program: WebGLProgram;
  indexBuffer: WebGLBuffer;
  codeBuffer: WebGLBuffer;
  colourBuffer: WebGLBuffer;
  locations: Record<"center" | "rotation" | "scale" | "half" | "viewport" | "size" | "round" | "alpha" | "oneColour" | "colour", WebGLUniformLocation | null>;
}

/** The program, buffers and blending state, or null when the driver rejects the program. */
function makeResources(gl: WebGL2RenderingContext): DotResources | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!program || !vertex || !fragment) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.detachShader(program, vertex);
  gl.detachShader(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(`The response plot draws its dots with Canvas 2D: ${gl.getProgramInfoLog(program)}`);
    gl.deleteProgram(program);
    return null;
  }
  const codeBuffer = gl.createBuffer();
  const colourBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (!codeBuffer || !colourBuffer || !indexBuffer) {
    gl.deleteBuffer(codeBuffer);
    gl.deleteBuffer(colourBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);
  const attribute = (buffer: WebGLBuffer, name: string, type: number, normalized: boolean) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, type, normalized, 0, 0);
  };
  attribute(codeBuffer, "aCode", gl.FLOAT, false);
  attribute(colourBuffer, "aColour", gl.UNSIGNED_BYTE, true);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const locations = {
    center: uniform("uCenter"),
    rotation: uniform("uRotation"),
    scale: uniform("uScale"),
    half: uniform("uHalf"),
    viewport: uniform("uViewport"),
    size: uniform("uSize"),
    round: uniform("uRound"),
    alpha: uniform("uAlpha"),
    oneColour: uniform("uOneColour"),
    colour: uniform("uColour"),
  };
  gl.enable(gl.BLEND);
  // Premultiplied source over: the same compositing as Canvas 2D.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  return { program, codeBuffer, colourBuffer, indexBuffer, locations };
}

/**
 * A WebGL2 dot layer on the page's own canvas, or null where the browser has no WebGL2
 * or its driver rejects the program; the page then draws the dots with Canvas 2D.
 * `?dots=canvas` asks for Canvas 2D, to compare the two.
 *
 * A browser may take the context away (a driver reset, too many contexts). While it is
 * lost, draw() returns false and the page draws with Canvas 2D; when it comes back, the
 * layer makes its program and buffers again and uploads the last dots. Each change calls
 * `onContextChange`, so the page redraws at once instead of at the next camera move.
 */
export function createDotLayer(canvas: HTMLCanvasElement, onContextChange: () => void): DotLayer | null {
  if (new URLSearchParams(location.search).get("dots") === "canvas") return null;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true });
  if (!gl) return null;
  let resources = makeResources(gl);
  if (!resources) return null;
  const colours = new Map<string, [number, number, number]>();
  // The last dots uploaded, to upload again after a restore.
  let uploaded: { codes_N3: Float32Array; colours_N3: Uint8Array } | null = null;
  const upload = (dots: { codes_N3: Float32Array; colours_N3: Uint8Array }) => {
    if (!resources || gl.isContextLost()) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.codeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, dots.codes_N3, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.colourBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, dots.colours_N3, gl.STATIC_DRAW);
  };
  const lost = (event: Event) => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    onContextChange();
  };
  const restored = () => {
    resources = makeResources(gl);
    if (uploaded) upload(uploaded);
    onContextChange();
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);

  return {
    setDots(codes, dotColours) {
      const codes_N3 = new Float32Array(codes.length * 3);
      const colours_N3 = new Uint8Array(codes.length * 3);
      codes.forEach((code, index) => {
        codes_N3.set(code, 3 * index);
        colours_N3.set(colourBytes(dotColours[index]!, colours), 3 * index);
      });
      uploaded = { codes_N3, colours_N3 };
      upload(uploaded);
    },
    draw(view, ratio, passes) {
      if (!resources || gl.isContextLost()) return false;
      const { locations } = resources;
      const uniforms = dotUniforms(view, ratio);
      const [width, height] = uniforms.viewport;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform3f(locations.center, ...uniforms.center);
      gl.uniform4f(locations.rotation, ...uniforms.rotation);
      gl.uniform1f(locations.scale, uniforms.scale);
      gl.uniform2f(locations.half, ...uniforms.half);
      gl.uniform2f(locations.viewport, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (const pass of passes) {
        if (pass.order.length === 0) continue;
        gl.uniform1f(locations.size, pass.size * ratio);
        gl.uniform1f(locations.round, pass.round ? 1 : 0);
        gl.uniform1f(locations.alpha, pass.alpha);
        gl.uniform1f(locations.oneColour, pass.colour === null ? 0 : 1);
        if (pass.colour !== null) gl.uniform3f(locations.colour, ...colourBytes(pass.colour, colours).map((byte) => byte / 255) as [number, number, number]);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pass.order, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.POINTS, pass.order.length, gl.UNSIGNED_INT, 0);
      }
      return true;
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      if (resources) {
        gl.deleteBuffer(resources.codeBuffer);
        gl.deleteBuffer(resources.colourBuffer);
        gl.deleteBuffer(resources.indexBuffer);
        gl.useProgram(null);
        gl.deleteProgram(resources.program);
        resources = null;
      }
      uploaded = null;
    },
  };
}
