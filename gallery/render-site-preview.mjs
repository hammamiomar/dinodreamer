// Compose the site's one share card from the published hibiscus WGSL recording.
// node gallery/render-site-preview.mjs --source <recording.mp4> --work <folder> [--browser <Chromium>]
// The source is library.computervision.vision/previews/block-4009-figure-pyramid-strongest-seed-0/preview.mp4.
// The work folder receives dinodreamer-hibiscus-v1.{mp4,jpg} and render-record.json: a 1280 × 640 H.264
// High yuv420p video at 30 fps, 6.033 s, no audio, metadata before the video data, and its frame at five
// seconds as JPEG. Needs ffmpeg; no model is trained or changed. Publish both files under previews/site/
// in the library bucket (video/mp4, image/jpeg) before deploying metadata that references them. The names
// are immutable: for a new composition, raise the version in the names and in SITE_PREVIEW (src/link-preview.ts).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { SITE_WORDS } from '../app/src/app/site-words.ts';

const { values: options } = parseArgs({ options: {
  source: { type: 'string' }, work: { type: 'string' }, browser: { type: 'string' },
} });
if (!options.source || !options.work) throw new Error('--source and --work are required');
const source = resolve(options.source);
const work = resolve(options.work);
mkdirSync(work, { recursive: true });
const font = readFileSync(new URL('../app/public/fonts/PaperMono-Variable.woff2', import.meta.url)).toString('base64');
const brand = resolve(work, 'wordmark.png');
const video = resolve(work, 'dinodreamer-hibiscus-v1.mp4');
const image = resolve(work, 'dinodreamer-hibiscus-v1.jpg');
const browser = await chromium.launch({ headless: true, executablePath: options.browser, args: ['--disable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>
    @font-face { font-family: Paper; src: url(data:font/woff2;base64,${font}); font-weight: 100 900; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 640px; height: 640px; background: #000; }
    main { width: 100%; height: 100%; display: grid; place-items: center;
      background-image: repeating-linear-gradient(45deg, transparent 0 63px, #141413 63px 64px),
        repeating-linear-gradient(-45deg, transparent 0 63px, #141413 63px 64px); }
    h1 { margin: 0; color: #efece8; font: 300 88px/1 Paper, monospace; letter-spacing: -.04em; }
  </style><main><h1></h1></main>`);
  await page.locator('h1').evaluate((element, title) => { element.textContent = title; }, SITE_WORDS.frame.wordmark);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: brand });
} finally {
  await browser.close();
}
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', '30', '-i', brand, '-i', source,
  '-filter_complex', '[1:v]scale=640:640:flags=neighbor,setsar=1[texture];[0:v][texture]hstack=inputs=2:shortest=1[card]',
  '-map', '[card]', '-an', '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p',
  '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-shortest', video]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '5', '-i', video, '-frames:v', '1', '-q:v', '2', image]);
const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration,size:stream=codec_name,profile,pix_fmt,width,height,r_frame_rate', '-of', 'json', video], { encoding: 'utf8' }));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const record = {
  source: { url: 'https://library.computervision.vision/previews/block-4009-figure-pyramid-strongest-seed-0/preview.mp4', sha256: sha256(source) },
  composition: { width: 1280, height: 640, split: 640, wordmark: SITE_WORDS.frame.wordmark, posterSeconds: 5 },
  video: { bytes: statSync(video).size, sha256: sha256(video), ...metadata },
  image: { bytes: statSync(image).size, sha256: sha256(image) },
};
if (record.video.bytes + record.image.bytes > 2_000_000) throw new Error('The shared media exceeds the 2 MB budget');
writeFileSync(resolve(work, 'render-record.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record, null, 2));
