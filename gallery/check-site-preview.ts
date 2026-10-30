// Check the actual HTML, static media delivery and browser playback of a deployed share preview.
// node gallery/check-site-preview.ts <origin> [--browser <Chromium>] [--engine webkit]
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { chromium, webkit } from "playwright-core";
import sharp from "sharp";

const { values: options, positionals } = parseArgs({ allowPositionals: true, options: {
  browser: { type: "string" }, engine: { type: "string", default: "chromium" },
} });
const origin = (positionals[0] ?? "http://127.0.0.1:5272").replace(/\/$/, "");
assert.ok(options.engine === "chromium" || options.engine === "webkit");
let video = "";
let image = "";
for (const path of ["/", "/how", "/automata", "/index/basis/4009?sort=block"]) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const tag = (name: string) => {
    const matches = [...html.matchAll(new RegExp(`<meta property="${name}" content="([^"]+)"`, "g"))];
    assert.equal(matches.length, 1, `${path}: missing or duplicate ${name}`);
    return matches[0]![1]!;
  };
  const currentVideo = tag("og:video");
  const currentImage = tag("og:image");
  assert.equal(tag("og:video:type"), "video/mp4");
  assert.equal(tag("og:image:type"), "image/jpeg");
  assert.equal(tag("og:video:width"), "1280");
  assert.equal(tag("og:video:height"), "640");
  assert.ok(html.indexOf('property="og:video"') < html.indexOf("</head>"));
  if (video) assert.equal(currentVideo, video);
  if (image) assert.equal(currentImage, image);
  video = currentVideo;
  image = currentImage;
}
const poster = await fetch(image);
assert.equal(poster.headers.get("content-type")?.split(";")[0], "image/jpeg");
const posterBytes = Buffer.from(await poster.arrayBuffer());
const dimensions = await sharp(posterBytes).metadata();
assert.equal(dimensions.width, 1280);
assert.equal(dimensions.height, 640);
const header = await fetch(video, { method: "HEAD" });
assert.equal(header.status, 200);
assert.equal(header.headers.get("content-type")?.split(";")[0], "video/mp4");
const range = await fetch(video, { headers: { Range: "bytes=0-127" } });
assert.equal(range.status, 206, "Video must support byte ranges");
assert.equal((await range.arrayBuffer()).byteLength, 128);
const videoBytes = Number(range.headers.get("content-range")?.split("/")[1]);
assert.ok(videoBytes > 0 && videoBytes + posterBytes.length < 2_000_000);

const browser = options.engine === "webkit"
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ headless: true, executablePath: options.browser, args: ["--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setContent('<video muted playsinline loop></video>');
  await page.locator("video").evaluate((element, source) => { (element as HTMLVideoElement).src = source; }, video);
  await page.locator("video").evaluate(element => (element as HTMLVideoElement).play());
  await page.waitForTimeout(350);
  const playback = await page.locator("video").evaluate(element => {
    const video = element as HTMLVideoElement;
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, currentTime: video.currentTime, error: video.error?.message ?? null };
  });
  assert.equal(playback.width, 1280);
  assert.equal(playback.height, 640);
  assert.ok(playback.duration > 5 && playback.duration < 7);
  assert.ok(playback.currentTime > 0);
  assert.equal(playback.error, null);
  console.log(JSON.stringify({ origin, engine: options.engine, routes: 4, image, video, imageBytes: posterBytes.length, videoBytes, rangeStatus: range.status, playback }, null, 2));
} finally {
  await browser.close();
}
