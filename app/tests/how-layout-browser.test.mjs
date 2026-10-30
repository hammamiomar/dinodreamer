// GALLERY_WORKER=https://dinodreamer.computervision.vision pnpm develop:remote --port 5180
// SHELL_GALLERY_TEST_BASE_URL=http://127.0.0.1:5180 node --test tests/how-layout-browser.test.mjs
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../../gallery/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  headless: true,
  ...(process.env.SHELL_BROWSER_EXECUTABLE ? { executablePath: process.env.SHELL_BROWSER_EXECUTABLE } : { channel: 'chromium-headless-shell' }),
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'],
});
after(() => browser.close());
const base = process.env.SHELL_GALLERY_TEST_BASE_URL ?? 'http://127.0.0.1:5180';
const evidence = process.env.HOW_LAYOUT_EVIDENCE;
const sections = ['overview', 'patches', 'attention', 'basis-place', 'selection', 'cloud', 'rebuild', 'basis-training', 'visualization', 'cells', 'scales', 'signal', 'updates', 'local-global', 'results', 'glossary'];

async function open(page, section) {
  await page.goto(`${base}/how?layout=${section}#${section}`);
  await page.locator(`.how[data-section="${section}"]`).waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

function inspectLayout() {
  const failures = [];
  const bounds = (node) => node.getBoundingClientRect();
  const close = (a, b) => Math.abs(a - b) <= 1;
  if (document.documentElement.scrollWidth > innerWidth) failures.push('horizontal page overflow');
  if (innerWidth >= 1024) {
    const stage = document.querySelector('.how-figure');
    const drawing = bounds(stage.firstElementChild);
    const expectedTop = bounds(stage).top + Math.max(0, (stage.clientHeight - drawing.height) / 2);
    if (!close(drawing.top, expectedTop)) failures.push('the complete figure block is not vertically centered');
  }
  for (const node of document.querySelectorAll('.how-figure [role="alert"]')) failures.push(node.textContent);
  for (const node of document.querySelectorAll('.how-caption, .how-figure-line, .how-stage .slider')) {
    if (node.scrollWidth > node.clientWidth + 1) failures.push(`text exceeds its box: ${node.className}`);
  }
  for (const stage of document.querySelectorAll('.how-map-stage[data-present]')) {
    if (getComputedStyle(stage.closest('svg')).visibility === 'hidden' || stage.closest('svg').getBoundingClientRect().width === 0) continue;
    const box = stage.querySelector(':scope > rect').getBBox();
    for (const text of stage.querySelectorAll(':scope > text')) {
      const label = text.getBBox();
      if (label.x < box.x || label.x + label.width > box.x + box.width || label.y < box.y || label.y + label.height > box.y + box.height) failures.push(`map text outside ${stage.dataset.stage}: ${text.textContent}`);
    }
  }
  for (const pane of document.querySelectorAll('.how-pane:has(> .how-visual), .how-cloud')) {
    const visual = pane.querySelector(':scope > .how-visual');
    const caption = pane.querySelector(':scope > .how-caption');
    if (!visual || !caption) continue;
    const drawing = bounds(visual);
    const words = bounds(caption);
    if (!close(drawing.width, words.width) || !close(drawing.left, words.left)) failures.push(`caption width or alignment differs: ${pane.className}`);
    if (words.top < drawing.bottom - 1) failures.push(`caption overlaps picture: ${pane.className}`);
    for (const reserve of caption.querySelectorAll('.how-caption-reserve')) {
      if (bounds(reserve).height > words.height + 1) failures.push('caption reserve exceeds its area');
    }
  }
  for (const pair of document.querySelectorAll('.how-pair')) {
    const pictures = [...pair.querySelectorAll(':scope > .how-pane > .how-visual, :scope > .how-pane > .how-cell-row')].map(bounds);
    const columns = getComputedStyle(pair).gridTemplateColumns.split(' ').length;
    if (columns > 1 && pictures.length > 1) {
      for (const box of pictures.slice(1)) {
        if (!close(box.top, pictures[0].top) || !close(box.width, pictures[0].width) || !close(box.height, pictures[0].height)) failures.push('paired pictures have different boxes');
      }
    }
  }
  const strongest = document.querySelector('.how-strongest');
  if (strongest) {
    const row = bounds(strongest);
    const drawing = bounds(document.querySelector('.how-cloud > .how-visual'));
    const tiles = [...strongest.querySelectorAll('.how-tile')].map(bounds);
    if (!close((row.left + row.right) / 2, (drawing.left + drawing.right) / 2)) failures.push('strongest row is off center');
    if (!close(row.width, bounds(strongest.querySelector('.how-caption')).width)) failures.push('strongest caption exceeds its row');
    if (tiles.length !== 4 || !close((tiles[0].left + tiles.at(-1).right) / 2, (drawing.left + drawing.right) / 2)) failures.push('strongest pictures are off center');
  }
  const images = [...document.querySelectorAll('.how-figure img')];
  if (images.some((image) => image.complete && image.naturalWidth === 0)) failures.push('broken figure image');
  return failures;
}

async function pictureBoxes(page) {
  return page.locator('.how-visual, .how-cell-row, .how-chart').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    const stage = node.closest('.how-figure');
    return { x: box.x, y: box.y + scrollY + stage.scrollTop, width: box.width, height: box.height };
  }));
}

async function hoverPatches(page, before, section) {
  const picture = page.locator('.how-picture').first();
  for (const fraction of [0.02, 0.52, 0.98]) {
    await picture.dispatchEvent('pointermove', await picture.evaluate((node, at) => {
      const box = node.getBoundingClientRect();
      return { clientX: box.left + box.width * at, clientY: box.top + box.height * at };
    }, fraction));
    assert.deepEqual(await pictureBoxes(page), before, `${section}: hover changed picture boxes`);
  }
  if (section === 'signal') assert.equal(await page.locator('.cloud-figure-landed [data-marked]').count(), 1);
  else assert.match(await page.locator('.how-caption-area > div:not([aria-hidden])').first().textContent(), /16, 16/);
}

const viewports = [
  { width: 320, height: 900 },
  { width: 390, height: 900 },
  { width: 1440, height: 900 },
  { width: 1700, height: 1000 },
  { width: 1440, height: 1400 },
];
for (const viewport of viewports) {
  const { width, height } = viewport;
  const size = `${width}-${height}`;
  test(`all How figures fit and stay fixed at ${width}×${height}px`, async () => {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const errors = [];
    const findings = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.text().includes('Maximum update depth exceeded')) errors.push(message.text()); });
    try {
      if (evidence) await mkdir(evidence, { recursive: true });
      for (const section of sections) {
        await open(page, section);
        const issues = await page.evaluate(inspectLayout);
        if (section === 'overview' || section === 'cells') assert.ok(await page.locator('.home-material').count() > 0, 'the gallery supplies the automaton picture');
        findings.push({ section, issues });
        if (evidence) {
          await page.screenshot({ path: `${evidence}/${section}-${size}.png`, fullPage: width < 1024 });
          if (width >= 1024 && await page.locator('.how-figure').evaluate(node => node.scrollHeight > node.clientHeight + 1)) {
            await page.locator('.how-figure').evaluate(node => { node.scrollTop = node.scrollHeight; });
            await page.screenshot({ path: `${evidence}/${section}-${size}-bottom.png` });
            await page.locator('.how-figure').evaluate(node => { node.scrollTop = 0; });
          }
        }
        const before = await pictureBoxes(page);
        if (['patches', 'attention', 'signal', 'local-global'].includes(section)) {
          await hoverPatches(page, before, section);
        }
        if (['attention', 'rebuild', 'basis-training', 'updates'].includes(section)) {
          const slider = page.getByRole('slider').first();
          await slider.press('Home');
          await page.waitForLoadState('networkidle');
          assert.deepEqual(await pictureBoxes(page), before, `${section}: minimum changed picture boxes`);
          await slider.press('End');
          await page.waitForLoadState('networkidle');
          assert.deepEqual(await pictureBoxes(page), before, `${section}: maximum changed picture boxes`);
        }
        if (section === 'selection') {
          const rows = page.locator('.how-response-bars button');
          for (let index = 0; index < await rows.count(); index++) {
            await rows.nth(index).hover();
            assert.deepEqual(await pictureBoxes(page), before, 'selected group changed picture boxes');
          }
        }
        if (section === 'scales') {
          await page.locator('.how-stack').click();
          assert.deepEqual(await pictureBoxes(page), before, 'stack caption changed picture boxes');
        }
      }
      assert.deepEqual(findings.filter(row => row.issues.length), []);
      assert.deepEqual(errors, []);
    } finally {
      if (evidence) await writeFile(`${evidence}/checks-${size}.json`, JSON.stringify({ findings, errors }, null, 2));
      await page.close();
    }
  });
}
