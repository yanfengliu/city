// city visual-sweep: the standing multi-angle, multi-zoom look at the rendered
// game (docs/learning/defect-register.md).
//
// A single framing is not visual verification. Every defect the user has
// reported so far was invisible from at least one angle or zoom — a canopy
// hovering over its trunk reads as fine from above, and a hairline joint is
// sub-pixel until you are close. This boots the game, builds one deterministic
// scene containing every model the renderer can draw, and photographs each
// subject from four azimuths at three distances, then assembles a contact
// sheet per subject so the whole set can be reviewed in a few images.
//
// Automated per frame: the frame actually drew geometry, the WebGL context is
// alive, and the page logged no errors. Everything else is for the eye — that
// is the point of the sheet.
//
// Env: CITY_PLAYTEST_URL (reuse a running server), CITY_SWEEP_SUBJECTS
// (comma-separated subject filter), CITY_SWEEP_OUT (output root).

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const cwd = process.cwd();
const configuredUrl = process.env.CITY_PLAYTEST_URL?.trim() ?? '';
const subjectFilter = (process.env.CITY_SWEEP_SUBJECTS ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const outRoot = process.env.CITY_SWEEP_OUT?.trim() || path.join(cwd, 'output', 'visual-sweep');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(outRoot, stamp);

const AZIMUTHS = [
  { name: 'ne', radians: Math.PI * 0.25 },
  { name: 'se', radians: Math.PI * 0.75 },
  { name: 'sw', radians: Math.PI * 1.25 },
  { name: 'nw', radians: Math.PI * 1.75 },
];

/**
 * Distance and eye height as multiples of the subject's own size. Height is
 * measured from the ground and is the ONLY control over the view angle: the
 * game re-pins `controls.target` to the terrain every frame, so an aim point
 * raised above the ground is erased before the shutter (see below).
 *
 * `grazing` is deliberately near eye level: a part floating off its support is
 * hidden by any steep view and obvious from one that skims the ground, which is
 * how the canopy defect in the registry escaped its first screenshot.
 */
const ZOOMS = [
  { name: 'close', distance: 1.3, height: 1.0 },
  { name: 'grazing', distance: 2.4, height: 0.42 },
  { name: 'play', distance: 4.5, height: 2.4 },
  { name: 'far', distance: 12, height: 7 },
];

/** Overview subjects get the wide pair; a single model gets the close pair. */
const OVERVIEW_ZOOMS = ZOOMS.filter((zoom) => zoom.name === 'play' || zoom.name === 'far');
const MODEL_ZOOMS = ZOOMS.filter((zoom) => zoom.name === 'close' || zoom.name === 'grazing');

const VIEWPORT = { width: 900, height: 700 };

let server;
let browser;
const consoleErrors = [];
const frames = [];

try {
  await fs.mkdir(runDir, { recursive: true });
  if (!configuredUrl) {
    // No HMR and no watcher: a background re-transform mid-sweep reloads the
    // page, which destroys the scene the frames are supposed to be of.
    server = await createServer({
      root: cwd,
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 5177, strictPort: false, hmr: false, watch: null },
    });
    await server.listen();
  }
  const url = new URL(configuredUrl || server?.resolvedUrls?.local?.[0] || 'http://127.0.0.1:5177/');
  url.searchParams.set('record', '1');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__harness), null, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  const scene = await buildScene(page);
  console.log(`scene origin (${scene.origin[0]}, ${scene.origin[1]})`);
  for (const step of scene.steps) {
    console.log(`  ${step.accepted ? 'ok  ' : 'FAIL'} ${step.name} — ${step.message}`);
  }

  const subjects = scene.subjects.filter(
    (subject) => subjectFilter.length === 0 || subjectFilter.includes(subject.name),
  );
  for (const subject of subjects) {
    // The HUD is part of the product, so the city overview keeps it; a model
    // close-up hides it, because a fifth of the frame covered by toolbar is a
    // fifth of the model nobody is inspecting.
    await setChrome(page, Boolean(subject.overview));
    const zooms = subject.overview ? OVERVIEW_ZOOMS : MODEL_ZOOMS;
    for (const zoom of zooms) {
      for (const azimuth of AZIMUTHS) {
        const file = `${subject.name}-${zoom.name}-${azimuth.name}.png`;
        const drawn = await aim(page, subject, zoom, azimuth.radians);
        await page.screenshot({ path: path.join(runDir, file) });
        frames.push({ file, subject: subject.name, zoom: zoom.name, azimuth: azimuth.name, ...drawn });
      }
    }
    console.log(`captured ${subject.name}`);
  }

  await writeContactSheets(context, runDir, subjects, frames);
  await fs.writeFile(
    path.join(runDir, 'frames.json'),
    `${JSON.stringify({ stamp, scene: scene.steps, frames, consoleErrors }, null, 2)}\n`,
  );

  const blank = frames.filter((frame) => frame.triangles === 0);
  const lost = frames.filter((frame) => frame.contextLost);
  report(runDir, frames, blank, lost);
  if (blank.length || lost.length || consoleErrors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}

/**
 * Deterministic scene: one road spine on the first dry patch, every service
 * and utility model beside it, and zoned blocks so buildings and traffic are
 * in frame too. Returns what was accepted, so a refused placement is visible
 * in the report instead of quietly leaving a subject un-photographed.
 */
async function buildScene(page) {
  return page.evaluate(async () => {
    const harness = window.__harness;
    const game = window.__game;
    const surface = game.scene.terrainSurface;
    const dry = (x, z) => surface.water[z * surface.width + x] !== 1;

    let origin = null;
    for (let y = 20; y < 100 && !origin; y++) {
      for (let x = 20; x < 100 && !origin; x++) {
        let ok = true;
        for (let dx = -1; dx <= 26 && ok; dx++) {
          for (let dy = -9; dy <= 6 && ok; dy++) if (!dry(x + dx, y + dy)) ok = false;
        }
        if (ok) origin = [x, y];
      }
    }
    if (!origin) throw new Error('no dry patch wide enough for the sweep scene');
    const [ox, oy] = origin;

    const steps = [];
    const send = async (name, data) => {
      harness.command(name, data);
      await new Promise((resolve) => setTimeout(resolve, 220));
      const last = harness.state().lastCommandSubmission;
      steps.push({ name: `${name} ${JSON.stringify(data)}`, accepted: Boolean(last?.accepted), message: last?.message ?? '' });
    };

    // Layout, north (-y) to south (+y):
    //   oy-8  utility row: coal plant, wind turbine
    //   oy-6  power line spanning the scene
    //   oy-4  link road running west to the highway gateway
    //   oy-2  commercial strip (within 2 cells of the main road)
    //   oy    main road + cross road
    //   oy+1  residential strip
    //   oy+1  services along the south side
    await send('placeRoad', { ax: ox, ay: oy, bx: ox + 24, by: oy });
    await send('placeRoad', { ax: ox + 12, ay: oy - 4, bx: ox + 12, by: oy + 4 });
    // Nothing grows in a city with no outside connection — the game's advisor
    // says so directly, and an unlinked scene photographs empty zones forever.
    // The gateway is the seeded highway column at the middle of the north edge,
    // not any north-edge cell, so the link is routed to it explicitly.
    const gatewayX = Math.floor(surface.width / 2);
    await send('placeRoad', { ax: ox + 12, ay: oy - 4, bx: gatewayX, by: oy - 4 });
    await send('placeRoad', { ax: gatewayX, ay: 9, bx: gatewayX, by: oy - 4 });

    const services = [
      ['fireStation', 1, 1], ['police', 4, 1], ['clinic', 7, 1],
      ['school', 15, 1], ['park', 18, 1], ['garden', 21, 1],
    ];
    for (const [service, dx, dy] of services) {
      await send('placeService', { service, x: ox + dx, y: oy + dy });
    }
    await send('placePowerPlant', { kind: 'coal', x: ox + 1, y: oy - 8 });
    await send('placePowerPlant', { kind: 'wind', x: ox + 6, y: oy - 8 });
    await send('placePowerLine', { ax: ox + 2, ay: oy - 6, bx: ox + 20, by: oy - 6 });
    await send('placePowerLine', { ax: ox + 14, ay: oy - 6, bx: ox + 14, by: oy + 3 });
    // Coverage is a radius around the conductor, so the line and the pipe run
    // alongside each zone strip rather than near it.
    await send('placePowerLine', { ax: ox + 8, ay: oy + 3, bx: ox + 20, by: oy + 3 });
    await send('placePowerLine', { ax: ox + 14, ay: oy - 3, bx: ox + 24, by: oy - 3 });

    // Buildings need water as well as power, and a pump needs a shore. Without
    // this the zones stay empty and the sweep never photographs the model the
    // player sees more than any other.
    let shore = null;
    for (let radius = 2; radius < 30 && !shore; radius++) {
      for (let dx = -radius; dx <= radius && !shore; dx++) {
        for (let dy = -radius; dy <= radius && !shore; dy++) {
          const x = ox + 10 + dx;
          const y = oy + dy;
          if (x < 1 || y < 1 || x >= surface.width - 1 || y >= surface.height - 1) continue;
          if (!dry(x, y)) continue;
          if (x === gatewayX || (y >= oy - 4 && y <= oy && Math.abs(x - (ox + 12)) < 2)) continue;
          const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([sx, sy]) => !dry(x + sx, y + sy));
          if (wet) shore = [x, y];
        }
      }
    }
    if (shore) {
      // Utility runs stay OFF the zone rows: a pipe or line laid through a
      // zoned cell occupies it, and a strip with no clear footprint left grows
      // nothing while still reporting itself as zoned.
      await send('placeWaterPump', { x: shore[0], y: shore[1] });
      await send('placePipe', { ax: shore[0], ay: shore[1], bx: shore[0], by: oy + 3 });
      await send('placePipe', { ax: shore[0], ay: oy + 3, bx: ox + 20, by: oy + 3 });
      await send('placePipe', { ax: ox + 14, ay: oy + 3, bx: ox + 14, by: oy - 3 });
      await send('placePipe', { ax: ox + 14, ay: oy - 3, bx: ox + 24, by: oy - 3 });
    } else {
      steps.push({ name: 'placeWaterPump', accepted: false, message: 'no shore cell within 30 cells of the scene — zones will stay unbuilt' });
    }

    // All three zone kinds: the onboarding advisory asks for R, C and I, and it
    // keeps firing — suppressing growth — until every one of them exists.
    await send('zone', { zone: 'residential', ax: ox + 9, ay: oy + 1, bx: ox + 11, by: oy + 2 });
    await send('zone', { zone: 'commercial', ax: ox + 16, ay: oy - 2, bx: ox + 19, by: oy - 1 });
    await send('zone', { zone: 'industrial', ax: ox + 21, ay: oy - 2, bx: ox + 24, by: oy - 1 });

    harness.advance(900_000);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const grown = harness.state();
    steps.push({
      name: 'grown buildings',
      accepted: Number(grown.populationPeople) > 0,
      // The game's own advisor names what a city is missing; quoting it beats
      // guessing why a scene stayed empty.
      message:
        `population ${grown.populationPeople}, buildings ${grown.buildingCount}, ` +
        `zoned cells ${grown.zonedCellCount}, demand ${JSON.stringify(grown.demand)}, ` +
        `power ${JSON.stringify(grown.power)}, water ${JSON.stringify(grown.water)}, ` +
        `advisor ${JSON.stringify(grown.advisories)}`,
    });

    const subjects = [
      { name: 'city', x: ox + 12, z: oy, size: 14, overview: true },
      { name: 'fireStation', x: ox + 2, z: oy + 2, size: 2 },
      { name: 'police', x: ox + 5, z: oy + 2, size: 2 },
      { name: 'clinic', x: ox + 8, z: oy + 2, size: 2 },
      { name: 'school', x: ox + 16, z: oy + 2, size: 2 },
      { name: 'park', x: ox + 19, z: oy + 2, size: 2 },
      { name: 'garden', x: ox + 22, z: oy + 2, size: 2 },
      { name: 'coalPlant', x: ox + 2, z: oy - 3, size: 3 },
      { name: 'windTurbine', x: ox + 6.5, z: oy - 3.5, size: 2 },
      { name: 'buildings', x: ox + 10, z: oy + 2, size: 4 },
      { name: 'streetscape', x: ox + 12, z: oy, size: 3 },
    ];
    return { origin, steps, subjects };
  });
}

/** Shows or hides every DOM layer over the canvas (HUD, panels, advisor). */
async function setChrome(page, visible) {
  await page.evaluate((show) => {
    const app = document.getElementById('app');
    if (!app) return;
    for (const child of app.children) {
      if (child instanceof HTMLCanvasElement) continue;
      child.style.visibility = show ? '' : 'hidden';
    }
  }, visible);
}

/** Points the camera at one subject and reports what the frame actually drew. */
async function aim(page, subject, zoom, azimuth) {
  const drawn = await page.evaluate(
    ([target, view, angle]) => {
      const scene = window.__game.scene;
      const PointVector = scene.camera.position.constructor;
      /** World bounds of every canopy instance whose cell is near (x, z). */
      const nearbyCanopyBounds = (host, x, z) => {
        const trees = host.scene.getObjectByName('trees');
        if (!trees) return [];
        const boxes = [];
        for (const mesh of trees.children) {
          if (!mesh.isInstancedMesh || mesh.name.endsWith('-trunks')) continue;
          mesh.geometry.computeBoundingBox();
          const local = mesh.geometry.boundingBox;
          const Matrix = mesh.matrixWorld.constructor;
          const matrix = new Matrix();
          for (let slot = 0; slot < mesh.count; slot++) {
            mesh.getMatrixAt(slot, matrix);
            const e = matrix.elements;
            if (Math.abs(e[12] - x) > 2 || Math.abs(e[14] - z) > 2) continue;
            boxes.push(local.clone().applyMatrix4(matrix));
          }
        }
        return boxes;
      };
      // MapControls clamps play to minDistance 8 and a near-horizontal polar
      // limit — ergonomics, not physics. Left in place, every "close-up" here
      // is really an 8-unit view, and a hairline joint stays sub-pixel. The
      // clamps are lifted for inspection and never restored: this page exists
      // only to be photographed.
      scene.controls.minDistance = 0.02;
      scene.controls.maxPolarAngle = Math.PI * 0.498;
      const eyeY = scene.terrainSurface.heightAt(target.x, target.z);
      // Aim at the ground, never above it. CityScene pins controls.target.y to
      // the terrain every frame and shifts the camera by the same delta to keep
      // the angle — so a raised aim point silently DROPS the camera by that
      // amount between this call and the screenshot, which is what put the
      // first grazing frames underneath the map. Angle comes from eye height.
      scene.controls.target.set(target.x, eyeY, target.z);
      const eyeX = target.x + Math.sin(angle) * target.size * view.distance;
      const eyeZ = target.z + Math.cos(angle) * target.size * view.distance;
      // Height is measured against the ground UNDER THE CAMERA as well as under
      // the subject: with the polar clamp lifted, a low angle over sloping
      // terrain otherwise buries the camera in the hill it is standing on.
      const groundUnderEye = scene.terrainSurface.heightAt(eyeX, eyeZ);
      const baseY = Math.max(groundUnderEye, eyeY) + target.size * view.height;

      // A low camera lands inside a tree as often as not, and a frame filled
      // with the inside of a canopy hides the model it was aimed at. Lift until
      // the eye is clear of nearby foliage, and report how far it had to move.
      // Three's Raycaster is not reachable from the page without exporting it
      // from the app, so this tests the instance bounds directly — enough,
      // since foliage is the only thing dense enough to swallow the camera.
      const canopyBoxes = nearbyCanopyBounds(scene, eyeX, eyeZ);
      let lifted = 0;
      for (let attempt = 0; attempt < 6; attempt++) {
        const y = baseY + lifted;
        if (!canopyBoxes.some((box) => box.containsPoint(new PointVector(eyeX, y, eyeZ)))) break;
        lifted += target.size * 0.4;
      }
      scene.camera.position.set(eyeX, baseY + lifted, eyeZ);
      scene.camera.near = 0.05;
      scene.camera.updateProjectionMatrix();
      scene.controls.update();
      return {
        context: Boolean(scene.renderer.getContext()),
        lifted,
        groundUnderCamera: groundUnderEye,
        groundUnderTarget: eyeY,
        canopiesNear: canopyBoxes.length,
      };
    },
    [subject, zoom, azimuth],
  );
  await page.waitForTimeout(450);
  // Read the camera AFTER the settle, not before: the frame belongs to where
  // the camera ended up, and the two are not the same thing in this scene.
  const stats = await page.evaluate(() => {
    const scene = window.__game.scene;
    const renderer = scene.renderer;
    return {
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      contextLost: renderer.getContext().isContextLost(),
      cameraY: Number(scene.camera.position.y.toFixed(3)),
    };
  });
  return { ...drawn, ...stats };
}

/**
 * One image per subject, its frames laid out angle-by-zoom. Built by loading a
 * generated HTML grid in the same browser and screenshotting it — a review of
 * 11 sheets is a review that actually happens; 88 loose frames is not.
 */
async function writeContactSheets(context, dir, subjects, captured) {
  const sheetPage = await context.newPage();
  for (const subject of subjects) {
    const mine = captured.filter((frame) => frame.subject === subject.name);
    if (mine.length === 0) continue;
    const zooms = [...new Set(mine.map((frame) => frame.zoom))];
    const rows = zooms
      .map((zoom) => {
        const cells = AZIMUTHS.map((azimuth) => {
          const frame = mine.find((item) => item.zoom === zoom && item.azimuth === azimuth.name);
          if (!frame) return '<td></td>';
          return `<td><figure><img src="${frame.file}"><figcaption>${zoom} · ${azimuth.name} · ${frame.triangles.toLocaleString()} tris</figcaption></figure></td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#14171c;color:#e6edf3;font:13px/1.4 system-ui,sans-serif}
h1{margin:12px 16px;font-size:16px}
table{border-collapse:collapse;margin:0 8px 12px}
td{padding:4px;vertical-align:top}
figure{margin:0}
img{display:block;width:440px;border:1px solid #2b3138}
figcaption{padding:3px 1px;color:#9fb0c0}
</style><h1>${subject.name}</h1><table>${rows}</table>`;
    const htmlPath = path.join(dir, `sheet-${subject.name}.html`);
    await fs.writeFile(htmlPath, `${html}\n`);
    await sheetPage.goto(`file://${htmlPath.split(path.sep).join('/')}`, { waitUntil: 'load' });
    await sheetPage.waitForTimeout(250);
    await sheetPage.screenshot({ path: path.join(dir, `sheet-${subject.name}.png`), fullPage: true });
  }
  await sheetPage.close();
}

function report(dir, captured, blank, lost) {
  console.log(`\n${captured.length} frames -> ${dir}`);
  console.log('contact sheets: sheet-<subject>.png — open these, not the loose frames');
  if (blank.length) {
    console.log(`\nBLANK FRAMES (${blank.length}) — the camera drew no geometry:`);
    for (const frame of blank) console.log(`  ${frame.file}`);
  }
  if (lost.length) console.log(`\nWEBGL CONTEXT LOST in ${lost.length} frame(s)`);
  if (consoleErrors.length) {
    console.log(`\nPAGE ERRORS (${consoleErrors.length}):`);
    for (const error of consoleErrors.slice(0, 10)) console.log(`  ${error}`);
  }
  if (!blank.length && !lost.length && !consoleErrors.length) {
    console.log('\nAutomated checks clean. The frames still need a human look — that is the point.');
  }
}
