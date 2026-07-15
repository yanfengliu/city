// C-03 parity probe: draws City's building walls with and without the embedded
// Voxel wall lane, from the same tree, fixture, camera, and viewport, and
// compares draw calls, triangles, and actual pixels.
//
// Usage: node scripts/probe-voxel-walls.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const OUT = 'output/voxel-walls-parity';
const VIEWPORT = { width: 1280, height: 720 };

const fixture = await readFile('benchmarks/fixtures/performance-city-save.json', 'utf8');
await mkdir(OUT, { recursive: true });
const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });

async function measure(label, query) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(({ save }) => {
    localStorage.setItem('city.save.v1', save);
    localStorage.setItem('city.pendingLoad', '1');
    let game;
    Object.defineProperty(window, '__game', {
      configurable: true,
      get: () => game,
      set: (value) => { game = value; value.setSpeed(0); },
    });
  }, { save: fixture });
  await page.goto(`${url}/${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__game), null, { timeout: 60_000 });
  // Pin the camera so both runs render the identical view, then settle.
  await page.evaluate(() => {
    const scene = window.__game.scene;
    scene.camera.position.set(60, 55, 60);
    scene.controls.target.set(48, 0, 48);
    scene.camera.lookAt(48, 0, 48);
    scene.controls.update();
  });
  await page.waitForTimeout(2_500);
  const stats = await page.evaluate(() => {
    const game = window.__game;
    const scene = game.scene;
    const walls = [];
    let voxelRuntimeRoots = 0;
    scene.scene.traverse((node) => {
      if (typeof node.name !== 'string') return;
      if (node.name === 'voxel-runtime') voxelRuntimeRoots += 1;
      if (node.name.endsWith('-walls')) {
        walls.push({ name: node.name, visible: node.visible, count: node.count ?? 0 });
      }
    });
    return {
      calls: scene.renderer.info.render.calls,
      triangles: scene.renderer.info.render.triangles,
      buildings: game.buildingsView.count,
      voxelRuntimeRoots,
      drawnWallInstances: walls
        .filter((wall) => wall.visible)
        .reduce((sum, wall) => sum + wall.count, 0),
      walls,
    };
  });
  // City keeps preserveDrawingBuffer, so the drawn pixels can be read back
  // directly. A downsampled grid keeps the payload small while still catching
  // a wall lane that is missing, misplaced, or the wrong brightness.
  const pixels = await page.evaluate(({ cols, rows }) => {
    const canvas = window.__game.scene.renderer.domElement;
    const scratch = document.createElement('canvas');
    scratch.width = cols;
    scratch.height = rows;
    const context = scratch.getContext('2d');
    context.drawImage(canvas, 0, 0, cols, rows);
    return [...context.getImageData(0, 0, cols, rows).data];
  }, { cols: 64, rows: 36 });
  await page.screenshot({ path: `${OUT}/${label}.png` });
  await page.close();
  return { ...stats, errors, pixels };
}

const before = await measure('before-city-walls', '');
// Control: City animates vehicles, pedestrians and daylight from the wall
// clock, so two identical runs already differ. Without this noise floor an
// after-vs-before pixel delta means nothing.
const control = await measure('control-city-walls', '');
const after = await measure('after-voxel-walls', '?voxelWalls=1');

/** Channel-wise deviation between two downsampled grids, ignoring alpha. */
function compare(left, right) {
  let worst = 0;
  let total = 0;
  let compared = 0;
  // Channels differing by more than a few units: the count matters more than
  // the peak, since one moved vehicle produces a large isolated peak.
  let over8 = 0;
  let over24 = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (index % 4 === 3) continue;
    const delta = Math.abs(left[index] - right[index]);
    worst = Math.max(worst, delta);
    total += delta;
    compared += 1;
    if (delta > 8) over8 += 1;
    if (delta > 24) over24 += 1;
  }
  return {
    worstChannelDelta: worst,
    meanChannelDelta: total / compared,
    channelsOver8: over8,
    channelsOver24: over24,
    comparedChannels: compared,
  };
}

const report = {
  capturedAt: new Date().toISOString(),
  viewport: VIEWPORT,
  before: { ...before, pixels: undefined },
  after: { ...after, pixels: undefined },
  drawCallDelta: after.calls - before.calls,
  triangleDelta: after.triangles - before.triangles,
  // The control is the noise floor; the change is only meaningful relative to it.
  controlVsBefore: compare(before.pixels, control.pixels),
  afterVsBefore: compare(before.pixels, after.pixels),
};
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 1));

await browser.close();
await server.close();
