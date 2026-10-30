// Record 6-second link-preview videos for published, featured automata. The Worker uses the
// existing gallery posters for still images; this recorder makes no additional posters.
// The browser replays the material with the app's own runtime and its video export (replay-video.ts:
// readPixels into a 2D canvas, MediaRecorder); no WebGPU canvas is presented, so a headless Linux machine
// with Vulkan records it. ffmpeg then makes the MP4: one frame per recorded frame at 30 fps, H.264 High,
// yuv420p, faststart, at most 2 MB.
//
//   node engine/tools/record_link_previews.mjs --app <Vite dev server of the app> --materials <folder of
//     *.material.json> --index <published-materials.json> --out <folder>/previews
//     [--browser /usr/bin/chromium] [--only <published id>,<published id>] [--list]
//
// --list checks the selection without opening a browser. Publish preview.mp4 only, under
// previews/<published id>/. Keep the raw recording and run record as local evidence.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({ options: {
  app: { type: 'string' }, materials: { type: 'string' }, out: { type: 'string' }, browser: { type: 'string' }, only: { type: 'string' },
  index: { type: 'string' }, list: { type: 'boolean', default: false },
} });
if (!options.materials || !options.index || (!options.list && (!options.app || !options.out))) {
  throw new Error('--materials and --index are required; recording also requires --app and --out');
}
/** Ticks 0 to 720 at 4 ticks a frame and 30 frames a second: 6 s, the stage's 2x growth twice as fast. */
const PLAN = { fromTick: 0, toTick: 720, ticksPerFrame: 4, fps: 30 };
const MOST_BYTES = 2_000_000;
const VULKAN = ['--enable-gpu', '--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'];

const only = options.only?.split(',');
const index = JSON.parse(readFileSync(options.index, 'utf8'));
if (!Array.isArray(index.entries)) throw new Error('--index must contain the published entries');
const featured = index.entries.filter((entry) => entry.featured === true);
for (const id of only ?? []) {
  if (!featured.some((entry) => entry.id === id)) throw new Error(`${id} is not published and featured`);
}
const definitions = readdirSync(options.materials).filter((name) => name.endsWith('.material.json')).sort()
  .map((name) => ({ name, file: JSON.parse(readFileSync(join(options.materials, name), 'utf8')) }));
const selected = featured.filter((entry) => !only || only.includes(entry.id)).map((entry) => {
  const definition = definitions.find(({ name, file }) => name === `${entry.id}.material.json` || file.id === entry.materialId);
  if (!definition) throw new Error(`No definition for featured automaton ${entry.id}`);
  if (definition.file.id !== entry.materialId) throw new Error(`The definition for ${entry.id} has a different material id`);
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(entry.id)) throw new Error(`Invalid published id: ${entry.id}`);
  return { id: entry.id, file: definition.file };
});
if (options.list) {
  console.log(JSON.stringify({ featured: selected.map(({ id }) => id) }, null, 2));
  process.exit(0);
}
if (!selected.length) throw new Error('No published featured automata were selected');
for (const { id } of selected) {
  if (existsSync(join(options.out, id))) throw new Error(`Output already exists for ${id}; use a new output directory`);
}
const browser = await chromium.launch({
  ...(options.browser ? { executablePath: options.browser } : { channel: 'chrome' }),
  headless: true, args: platform() === 'linux' ? VULKAN : [],
});
const rows = [];
try {
  const page = await browser.newPage();
  await page.goto(options.app);
  for (const { id, file } of selected) {
    const folder = join(options.out, id);
    mkdirSync(folder, { recursive: true });
    const started = Date.now();
    const recorded = await page.evaluate(async ({ file, plan }) => {
      const { createFigureReplay } = await import('/src/replay/figure-replay.ts');
      const { FIGURE_SHADERS } = await import('/src/replay/figure-shaders.ts');
      const { recordReplayVideo } = await import('/src/replay/replay-video.ts');
      const { figurePlayback, readFigureMaterial, readingPictureSide } = await import('/src/materials/material-file.ts');
      const material = readFigureMaterial(file);
      const playback = figurePlayback(material.file);
      const side = readingPictureSide(material.file) / playback.pixelsPerCell;
      const device = await (await navigator.gpu.requestAdapter()).requestDevice();
      const replay = await createFigureReplay({ device, side, seed: material.file.reading.seed, ...playback },
        { values: material.values, fireRate: material.file.rule.fireRate }, FIGURE_SHADERS);
      try {
        const video = await recordReplayVideo(replay, { seed: material.file.reading.seed, ...plan });
        const encode = async (blob) => btoa(Array.from(new Uint8Array(await blob.arrayBuffer()), (byte) => String.fromCharCode(byte)).join(''));
        return { video: await encode(video.blob), extension: video.extension, frames: video.frames };
      } finally {
        replay.dispose();
        device.destroy();
      }
    }, { file, plan: PLAN });
    const recording = join(folder, `recording.${recorded.extension}`);
    writeFileSync(recording, Buffer.from(recorded.video, 'base64'));
    // MediaRecorder stamps frames with their capture time; setpts gives each recorded frame 1/30 s.
    let crf = 26;
    let bytes = Infinity;
    for (; bytes > MOST_BYTES && crf <= 38; crf += 4) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', recording, '-vf', 'setpts=N/30/TB', '-r', '30', '-an',
        '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', String(crf), '-movflags', '+faststart', join(folder, 'preview.mp4')]);
      bytes = statSync(join(folder, 'preview.mp4')).size;
    }
    if (bytes > MOST_BYTES) throw new Error(`${id}: the compressed video exceeds ${MOST_BYTES} bytes`);
    const row = { id, materialId: file.id, frames: recorded.frames, crf: crf - 4, mp4Bytes: bytes, seconds: (Date.now() - started) / 1000 };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
} finally {
  await browser.close();
}
writeFileSync(join(options.out, '..', 'previews-record.json'), JSON.stringify({ date: new Date().toISOString(), plan: PLAN, rows }, null, 1) + '\n');
