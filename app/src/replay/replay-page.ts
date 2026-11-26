import { replayGridSides, type FigureMaterialFile } from "../materials/material-file";
import { automatonTagName, defineAutomatonElement, embeddedAutomaton, scriptJson, type AutomatonMaker } from "./automaton-embed";
import { createFigureReplay } from "./figure-replay";
import { FIGURE_SHADERS } from "./figure-shaders";
import { materialLine, ownTitle } from "./material-facts";
import { REPLAY_DEFAULT_SPEED, REPLAY_SPEEDS, speedLabel, startReplayLoop } from "./replay-loop";

// The downloaded page: a plain page around the embed's element (automaton-embed.ts), with controls
// that set its attributes, and the automaton definition to download.

/**
 * The page's controls. Like the element, it has no runtime imports or enclosing values: the page
 * embeds its source unchanged.
 */
export function runReplayPage(tagName: string, file: FigureMaterialFile): void {
  const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const automaton = element<HTMLElement & { restart(): void }>(tagName);
  const play = element<HTMLButtonElement>("#play");
  const seed = element<HTMLInputElement>("#seed");
  if (!navigator.gpu) {
    play.textContent = "Play";
    for (const control of ["#play", "#speed", "#again", "#grid"]) element<HTMLButtonElement>(control).disabled = true;
    element("#status").textContent = "This browser has no WebGPU, so this is the still image. Open the page in a browser with WebGPU to grow it.";
  }
  play.onclick = () => {
    const paused = automaton.toggleAttribute("paused");
    play.textContent = paused ? "Play" : "Pause";
  };
  element<HTMLSelectElement>("#speed").onchange = (event) => automaton.setAttribute("speed", (event.target as HTMLSelectElement).value);
  element<HTMLSelectElement>("#grid").onchange = (event) => automaton.setAttribute("cells", (event.target as HTMLSelectElement).value);
  element<HTMLButtonElement>("#again").onclick = () => {
    automaton.setAttribute("seed", seed.value);
    automaton.restart();
  };
  element<HTMLButtonElement>("#download").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file.id}.material.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** The page's title: the title its maker gave, else its basis group. */
export function replayPageTitle(file: FigureMaterialFile, maker: AutomatonMaker): string {
  return ownTitle(maker.title, file) || `Basis group ${file.block}`;
}

/**
 * One HTML file: the element with its replay, loop and shaders, the controls and the definition.
 * It loads nothing. The element takes the rule and the still image from the embedded definition, so
 * the page holds them once.
 */
export function replayPageHtml(file: FigureMaterialFile, maker: AutomatonMaker): string {
  const tagName = automatonTagName(file);
  const { rule: _rule, still: _still, ...settings } = embeddedAutomaton(file, maker);
  const title = escapeHtml(replayPageTitle(file, maker));
  const by = maker.credit === "" ? "" : ` · by ${escapeHtml(maker.credit)}`;
  const grids = replayGridSides(file)
    .map((cells) => `<option value="${cells}"${cells === settings.cells ? " selected" : ""}>${cells} cells</option>`).join("");
  const speeds = REPLAY_SPEEDS
    .map((speed) => `<option value="${speed}"${speed === REPLAY_DEFAULT_SPEED ? " selected" : ""}>${speedLabel(speed)}</option>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark">
<title>${title}</title>
<style>
:root{color-scheme:dark;--ground:#000;--text:#ecebf2;--muted:#a3a2ad;--line:#2c2d35;font-family:system-ui,sans-serif}
body{margin:0;padding:24px 16px;background:var(--ground);color:var(--text);display:grid;justify-items:center}
main{width:min(100%,512px);display:grid;gap:14px}h1{font-size:20px;font-weight:600;margin:0}
.line{margin:0;color:var(--muted);font-size:14px;line-height:1.5}
${tagName}{width:100%;border-radius:6px}
form{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;font-size:14px}
label{display:flex;align-items:center;gap:6px}button,select,input{font:inherit;color:inherit}
button,select,input{background:transparent;border:1px solid var(--line);border-radius:6px;padding:6px 10px}
input{width:120px}button:disabled,select:disabled{opacity:.5}
#status{min-height:1.2em;font-size:14px;margin:0}footer{font-size:12px;color:var(--muted)}
</style></head>
<body><main>
<h1>${title}</h1>
<p class="line">${escapeHtml(materialLine(file))}${by}</p>
<${tagName} draw></${tagName}>
<form onsubmit="return false">
<button id="play" type="button">Pause</button>
<label>Speed <select id="speed">${speeds}</select></label>
<label>Seed <input id="seed" type="number" min="0" max="4294967295" step="1" value="${settings.seed}"></label>
<button id="again" type="button">Restart</button>
<label>Grid <select id="grid">${grids}</select></label>
<button id="download" type="button">Download automaton definition</button>
</form>
<p id="status" role="status"></p>
<footer>Made with DinoDreamer, computervision.vision. Draw on the automaton to disturb it. It grows on this device with WebGPU; the page loads nothing.</footer>
</main>
<script>
(() => {
const createReplay = ${createFigureReplay.toString()};
const startLoop = ${startReplayLoop.toString()};
const shaders = ${scriptJson(FIGURE_SHADERS)};
const material = ${scriptJson(file)};
const automaton = { ...${scriptJson(settings)}, rule: material.rule.values, still: material.preview };
(${defineAutomatonElement.toString()})(${scriptJson(tagName)}, automaton, createReplay, startLoop, shaders);
(${runReplayPage.toString()})(${scriptJson(tagName)}, material);
})();
</script></body></html>
`;
}

/** The page's file name: the embed's name, so the page and the embed file of one automaton sort together. */
export function replayPageName(file: FigureMaterialFile): string {
  return `${automatonTagName(file)}.html`;
}
