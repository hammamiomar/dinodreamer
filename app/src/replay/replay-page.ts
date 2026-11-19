import { figurePlayback, readingPictureSide, replayGridSides, type FigureMaterialFile, type FigurePlayback } from "../materials/material-file";
import { createFigureReplay, type FigureReplay, type FigureReplayOptions, type FigureRule } from "./figure-replay";
import { FIGURE_SHADERS, type FigureShaderSources } from "./figure-shaders";
import { materialLine } from "./material-facts";
import { REPLAY_DEFAULT_SPEED, REPLAY_SPEEDS, speedLabel, startReplayLoop, type ReplayLoop, type ReplayLoopOptions } from "./replay-loop";

/**
 * The page's DOM wiring. Like the replay and the loop, it has no runtime imports or
 * enclosing values: the exported page embeds the source of all three unchanged.
 */
export async function runReplayPage(
  createReplay: (options: FigureReplayOptions, rule: FigureRule, shaders: FigureShaderSources) => Promise<FigureReplay>,
  startLoop: (replay: FigureReplay, options: ReplayLoopOptions) => ReplayLoop,
  shaders: FigureShaderSources,
  file: FigureMaterialFile,
  playback: FigurePlayback,
) {
  const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const canvas = element<HTMLCanvasElement>("canvas");
  const status = element<HTMLElement>("#status");
  const tickOutput = element<HTMLOutputElement>("#tick");
  const play = element<HTMLButtonElement>("#play");
  const speed = element<HTMLSelectElement>("#speed");
  const seed = element<HTMLInputElement>("#seed");
  const grid = element<HTMLSelectElement>("#grid");
  const brush = element<HTMLInputElement>("#brush");
  const binary = atob(file.rule.values);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const rule = { values: new Float32Array(bytes.buffer), fireRate: file.rule.fireRate };
  let replay: FigureReplay | undefined;
  let loop: ReplayLoop | undefined;
  let starting: AbortController | undefined;
  let playing = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const labelPlay = () => { play.textContent = playing ? "Pause" : "Play"; };
  labelPlay();
  const report = (error: unknown) => {
    status.textContent = String(error instanceof Error ? error.message : error);
    playing = false;
    play.disabled = true;
    loop?.pause();
    labelPlay();
  };
  const close = () => {
    starting?.abort();
    loop?.stop();
    replay?.dispose();
    loop = undefined;
    replay = undefined;
  };
  const open = async () => {
    close();
    const current = new AbortController();
    starting = current;
    play.disabled = false;
    canvas.hidden = true;
    element<HTMLElement>("#poster").hidden = false;
    status.textContent = "Opening the automaton…";
    const reportCurrent = (error: unknown) => { if (!current.signal.aborted) report(error); };
    try {
      const side = Number(grid.value);
      const created = await createReplay({
        canvas, side, seed: Number(seed.value), scale: 512 / side, ...playback,
        onDeviceLost: reportCurrent, signal: current.signal,
      }, rule, shaders);
      if (current.signal.aborted) { created.dispose(); return; }
      replay = created;
      loop = startLoop(replay, {
        speed: Number(speed.value), playing, onError: reportCurrent,
        onFrame: (tick) => { tickOutput.value = `Step ${tick.toLocaleString("en-US")}`; },
      });
      element<HTMLElement>("#poster").hidden = true;
      canvas.hidden = false;
      status.textContent = "";
    } catch (error) {
      if (!current.signal.aborted) {
        replay?.dispose();
        replay = undefined;
        reportCurrent(error);
      }
    }
  };
  play.onclick = () => {
    playing = !playing;
    if (playing) loop?.play(); else loop?.pause();
    labelPlay();
  };
  speed.onchange = () => loop?.setSpeed(Number(speed.value));
  element<HTMLButtonElement>("#again").onclick = () => {
    if (!loop) { void open(); return; }
    try { loop.reseed(Number(seed.value)); status.textContent = ""; } catch (error) { report(error); }
  };
  grid.onchange = () => { void open(); };
  window.addEventListener("pagehide", close, { once: true });
  // The canvas is the brush: a drag stamps soft discs along its path; holding still stamps nothing.
  let last: { x: number; y: number } | null = null;
  const cell = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    const side = replay?.side ?? 128;
    return { x: (event.clientX - box.left) / box.width * side, y: (event.clientY - box.top) / box.height * side };
  };
  canvas.onpointerdown = (event) => { canvas.setPointerCapture(event.pointerId); last = cell(event); };
  canvas.onpointermove = (event) => {
    if (!last || !loop || !replay) return;
    const next = cell(event);
    loop.stroke(last.x, last.y, next.x, next.y, Number(brush.value) * replay.side / 128);
    last = next;
  };
  canvas.onpointerup = canvas.onpointercancel = () => { last = null; };
  element<HTMLButtonElement>("#download").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file.id}.material.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  if (!navigator.gpu) {
    playing = false;
    labelPlay();
    play.disabled = true;
    element<HTMLButtonElement>("#again").disabled = true;
    grid.disabled = true;
    speed.disabled = true;
    status.textContent = "This browser has no WebGPU, so this is the saved frame. Open the page in a browser with WebGPU to run it.";
    return;
  }
  await open();
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
/** JSON inside a script element: no "</script>", and the two line separators JavaScript rejects. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
/** One HTML file: the WGSL runtime, the loop, the page wiring and the material. No network access. */
export function replayPageHtml(file: FigureMaterialFile): string {
  const side = file.reading.side;
  const picture = readingPictureSide(file);
  const grids = replayGridSides(file).map((cells) => `<option value="${cells}"${cells === side ? " selected" : ""}>${cells} cells</option>`).join("");
  const line = escapeHtml(materialLine(file));
  const speeds = REPLAY_SPEEDS.map((speed) => `<option value="${speed}"${speed === REPLAY_DEFAULT_SPEED ? " selected" : ""}>${speedLabel(speed)}</option>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark">
<title>${escapeHtml(file.name)}</title>
<style>
:root{color-scheme:dark;--ground:#000;--text:#ecebf2;--muted:#a3a2ad;--line:#2c2d35;font-family:system-ui,sans-serif}
body{margin:0;padding:24px 16px;background:var(--ground);color:var(--text);display:grid;justify-items:center;gap:16px}
main{width:min(100%,560px);display:grid;gap:14px}h1{font-size:20px;font-weight:600;margin:0}
.line{margin:0;color:var(--muted);font-size:14px;line-height:1.5}
.stage{width:100%;aspect-ratio:1;background:#808080;border-radius:6px;overflow:hidden}
canvas,.stage img{display:block;width:100%;height:100%;image-rendering:pixelated;touch-action:none}
[hidden]{display:none!important}
form{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;font-size:14px}
label{display:flex;align-items:center;gap:6px}button,select,input{font:inherit;color:inherit}
button,select,input[type=number]{background:transparent;border:1px solid var(--line);border-radius:6px;padding:6px 10px}
input[type=number]{width:120px}output{font-variant-numeric:tabular-nums;color:var(--muted)}
#status{min-height:1.2em;font-size:14px;margin:0}footer{font-size:12px;color:var(--muted)}
</style></head>
<body><main>
<h1>${escapeHtml(file.name)}</h1>
<p class="line">${line}</p>
<div class="stage"><canvas hidden width="${picture}" height="${picture}" aria-label="The automaton, running. Draw on it to damage it."></canvas>
<img id="poster" src="${escapeHtml(file.preview)}" width="${picture}" height="${picture}" alt="The saved image frame of ${escapeHtml(file.name)}"></div>
<form onsubmit="return false">
<button id="play" type="button">Pause</button>
<label>Speed <select id="speed">${speeds}</select></label>
<output id="tick">Step 0</output>
<label>Seed <input id="seed" type="number" min="0" max="4294967295" step="1" value="${file.reading.seed}"></label>
<button id="again" type="button" aria-label="Reset to step 0">Reset</button>
<label>Grid <select id="grid">${grids}</select></label>
<label>Brush <input id="brush" type="range" min="2" max="32" step="1" value="12"></label>
<button id="download" type="button">Download automaton definition</button>
</form>
<p id="status" role="status">Opening the automaton…</p>
<footer>Made with DinoDreamer, computervision.vision. The automaton runs on this device with WebGPU; the page loads nothing.</footer>
</main>
<script type="module">
const createReplay = ${createFigureReplay.toString()};
const startLoop = ${startReplayLoop.toString()};
const shaders = ${scriptJson(FIGURE_SHADERS)};
const material = ${scriptJson(file)};
const playback = ${scriptJson(figurePlayback(file))};
await (${runReplayPage.toString()})(createReplay, startLoop, shaders, material, playback);
</script></body></html>
`;
}

export function replayPageName(file: FigureMaterialFile): string {
  return `${file.id}.html`;
}
