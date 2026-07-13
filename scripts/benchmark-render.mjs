import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { cleanupBrowserResources } from './frame-pacing-browser-lifecycle.mjs';
import { serveDist } from './frame-pacing-http.mjs';
import {
  acquireLoopbackLease,
  HOST_BENCHMARK_LEASE_PORT,
  LEASE_OWNER_READ_TIMEOUT_MS,
} from './frame-pacing-lease.mjs';
import { manifestDirectory } from './frame-pacing-manifest.mjs';
import {
  assertStableTree,
  parseNamedArgs,
  summarize,
  withTimeout,
} from './frame-pacing-support.mjs';

const WARMUP_FRAMES = 1_800;
const SAMPLE_FRAMES = 600;
const CLEANUP_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 30_000;
const PHASE_TIMEOUT_MS = 120_000;
const EXPECTED_FIXTURE_SEED = 12345;
const EXPECTED_STATE = Object.freeze({ tick: 1203, buildingCount: 453, vehiclesOnScreen: 88 });

function required(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function distribution(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

async function loadFixture(page, url, save) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  await page.addInitScript(({ fixture }) => {
    localStorage.setItem('city.save.v1', fixture);
    localStorage.setItem('city.pendingLoad', '1');
    let game;
    Object.defineProperty(window, '__game', {
      configurable: true,
      get: () => game,
      set: (value) => {
        game = value;
        value.setSpeed(0);
      },
    });
  }, { fixture: save });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(({ expected }) => {
      if (typeof window.render_game_to_text !== 'function') return false;
      const state = JSON.parse(window.render_game_to_text());
      return state.ready && state.speed === 0 && state.buildingCount === expected.buildingCount;
    }, { expected: EXPECTED_STATE }, { timeout: 30_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      href: location.href,
      hasGame: Boolean(window.__game),
      hasTextState: typeof window.render_game_to_text === 'function',
      state: typeof window.render_game_to_text === 'function'
        ? JSON.parse(window.render_game_to_text())
        : null,
      pendingLoad: localStorage.getItem('city.pendingLoad'),
      saveBytes: localStorage.getItem('city.save.v1')?.length ?? 0,
    }));
    throw new Error(`fixture did not settle: ${String(error)}\n${JSON.stringify({ diagnostic, pageErrors })}`);
  }
  await page.evaluate(() => window.advanceTime(50));
  await page.waitForFunction(({ expected }) => {
    const state = JSON.parse(window.render_game_to_text());
    return state.tick === expected.tick && state.vehiclesOnScreen === expected.vehiclesOnScreen;
  }, { expected: EXPECTED_STATE }, { timeout: 30_000 });
}

async function measure(page, label, sequence) {
  const raw = await page.evaluate(({ expected, sampleFrames, warmupFrames }) => {
    const state = JSON.parse(window.render_game_to_text());
    if (
      state.speed !== 0
      || state.tick !== expected.tick
      || state.buildingCount !== expected.buildingCount
      || state.vehiclesOnScreen !== expected.vehiclesOnScreen
    ) {
      throw new Error(`unexpected benchmark state: ${JSON.stringify(state)}`);
    }

    const cityScene = window.__game.scene;
    const renderer = cityScene.renderer;
    const gl = renderer.getContext();
    const renderMs = [];
    const calls = [];
    const triangles = [];
    renderer.setAnimationLoop(null);
    // The shipping renderer caps high-DPI backing buffers. This historical A/B
    // measures renderer changes, not unequal pixel counts.
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight, false);
    if (
      renderer.domElement.width !== innerWidth
      || renderer.domElement.height !== innerHeight
    ) {
      throw new Error(
        `benchmark buffer ${renderer.domElement.width}x${renderer.domElement.height} `
        + `does not match fixed viewport ${innerWidth}x${innerHeight}`,
      );
    }

    const renderOnce = (capture) => {
      if (capture) {
        const start = performance.now();
        renderer.render(cityScene.scene, cityScene.camera);
        gl.finish();
        renderMs.push(performance.now() - start);
        calls.push(renderer.info.render.calls);
        triangles.push(renderer.info.render.triangles);
        return;
      }
      renderer.render(cityScene.scene, cityScene.camera);
      gl.finish();
    };
    for (let index = 0; index < warmupFrames; index++) renderOnce(false);
    for (let index = 0; index < sampleFrames; index++) renderOnce(true);

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      state,
      browser: navigator.userAgent,
      webglRenderer: debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      viewport: [innerWidth, innerHeight],
      canvasBuffer: [renderer.domElement.width, renderer.domElement.height],
      dpr: devicePixelRatio,
      shadowAutoUpdate: renderer.shadowMap.autoUpdate,
      renderMs,
      calls,
      triangles,
    };
  }, { expected: EXPECTED_STATE, sampleFrames: SAMPLE_FRAMES, warmupFrames: WARMUP_FRAMES });

  return {
    label,
    sequence,
    ...raw,
    summary: {
      renderMs: summarize(raw.renderMs),
      averageCalls: raw.calls.reduce((sum, value) => sum + value, 0) / SAMPLE_FRAMES,
      averageTriangles: raw.triangles.reduce((sum, value) => sum + value, 0) / SAMPLE_FRAMES,
      callDistribution: distribution(raw.calls),
      triangleDistribution: distribution(raw.triangles),
    },
  };
}

function aggregate(runs, label) {
  const selected = runs.filter((run) => run.label === label);
  const average = (select) => selected.reduce((sum, run) => sum + select(run), 0) / selected.length;
  const pooledRender = summarize(selected.flatMap((run) => run.renderMs));
  return {
    runs: selected.length,
    meanRenderMs: average((run) => run.summary.renderMs.mean),
    p50RenderMs: pooledRender.p50,
    p95RenderMs: pooledRender.p95,
    p99RenderMs: pooledRender.p99,
    averageCalls: average((run) => run.summary.averageCalls),
    averageTriangles: average((run) => run.summary.averageTriangles),
  };
}

async function runBenchmark(args, resources) {
  const beforeDir = resolve(required(args, 'before-dir'));
  const afterDir = resolve(args.get('after-dir') ?? 'dist');
  const fixturePath = resolve(
    args.get('fixture') ?? 'benchmarks/fixtures/performance-city-save.json',
  );
  const outputPath = resolve(args.get('output') ?? 'output/performance/render-benchmark.json');
  const browserChannel = args.get('browser-channel') ?? 'chrome';
  const fixture = await readFile(fixturePath, 'utf8');
  const fixtureSave = JSON.parse(fixture);
  if (fixtureSave?.meta?.seed !== EXPECTED_FIXTURE_SEED) {
    throw new Error(
      `fixture seed ${String(fixtureSave?.meta?.seed)} `
      + `does not match boot terrain seed ${EXPECTED_FIXTURE_SEED}`,
    );
  }
  const [beforeManifest, afterManifest] = await Promise.all([
    manifestDirectory(beforeDir),
    manifestDirectory(afterDir),
  ]);
  const beforeServer = resources.beforeServer = await serveDist(beforeDir);
  const afterServer = resources.afterServer = await serveDist(afterDir);
  const browserServer = resources.browserServer = await chromium.launchServer({
    headless: true,
    channel: browserChannel,
    timeout: CONNECT_TIMEOUT_MS,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  console.log(`render benchmark browser PID ${browserServer.process().pid} (task-owned)`);
  const browser = resources.browser = await chromium.connect(
    browserServer.wsEndpoint(),
    { timeout: CONNECT_TIMEOUT_MS },
  );
  const order = [
    ['before', beforeServer.url],
    ['after', afterServer.url],
    ['after', afterServer.url],
    ['before', beforeServer.url],
  ];
  const runs = [];

  for (let index = 0; index < order.length; index++) {
    const [label, url] = order[index];
    console.log(`benchmark phase ${index + 1}/${order.length}: ${label}`);
    const run = await withTimeout((async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      try {
        page.setDefaultTimeout(60_000);
        await loadFixture(page, url, fixture);
        return await measure(page, label, index + 1);
      } finally {
        await withTimeout(
          page.close(),
          CLEANUP_TIMEOUT_MS,
          `benchmark phase ${index + 1} page cleanup`,
        );
      }
    })(), PHASE_TIMEOUT_MS, `benchmark phase ${index + 1}`);
    runs.push(run);
    console.log(
      `phase ${index + 1} mean=${run.summary.renderMs.mean.toFixed(4)}ms calls=${run.summary.averageCalls}`,
    );
  }

  const [beforeManifestAfter, afterManifestAfter] = await Promise.all([
    manifestDirectory(beforeDir),
    manifestDirectory(afterDir),
  ]);
  assertStableTree(
    beforeManifest.treeSha256,
    beforeManifestAfter.treeSha256,
    'before bundle changed during GPU render benchmark',
  );
  assertStableTree(
    afterManifest.treeSha256,
    afterManifestAfter.treeSha256,
    'after bundle changed during GPU render benchmark',
  );

  const before = aggregate(runs, 'before');
  const after = aggregate(runs, 'after');
  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    runOrder: order.map(([label]) => label),
    warmupFrames: WARMUP_FRAMES,
    sampleFrames: SAMPLE_FRAMES,
    fixture: {
      path: relative(process.cwd(), fixturePath).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(fixture).digest('hex'),
      expectedState: EXPECTED_STATE,
      seed: EXPECTED_FIXTURE_SEED,
    },
    refs: {
      before: args.get('before-ref') ?? null,
      after: args.get('after-ref') ?? null,
    },
    binaries: {
      before: beforeManifest,
      after: afterManifest,
    },
    host: {
      node: process.version,
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model ?? 'unknown',
      browserChannel,
    },
    aggregate: {
      before,
      after,
      meanRenderMsDelta: after.meanRenderMs - before.meanRenderMs,
      meanRenderMsReductionPct:
        (before.meanRenderMs - after.meanRenderMs) * 100 / before.meanRenderMs,
      drawCallReductionPct:
        (before.averageCalls - after.averageCalls) * 100 / before.averageCalls,
      triangleReductionPct:
        (before.averageTriangles - after.averageTriangles) * 100 / before.averageTriangles,
    },
    runs,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result.aggregate, null, 2));
  console.log(`raw benchmark: ${outputPath}`);
}

async function main() {
  const args = parseNamedArgs(process.argv.slice(2));
  const owner = {
    pid: process.pid,
    capturedAt: new Date().toISOString(),
    purpose: 'exclusive host GPU render benchmark',
  };
  const lease = await acquireLoopbackLease({
    host: '127.0.0.1',
    port: HOST_BENCHMARK_LEASE_PORT,
    owner,
    ownerReadTimeoutMs: LEASE_OWNER_READ_TIMEOUT_MS,
  });
  console.log(`render benchmark lease ${lease.port} owned by PID ${owner.pid}`);
  const resources = {};
  let benchmarkError;
  let cleanupError;
  let releaseError;
  try {
    await runBenchmark(args, resources);
  } catch (error) {
    benchmarkError = error;
  }
  try {
    await cleanupBrowserResources({
      browser: resources.browser,
      browserServer: resources.browserServer,
      httpServers: [resources.beforeServer, resources.afterServer].filter(Boolean),
      cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
    });
  } catch (error) {
    cleanupError = error;
  }
  try {
    await withTimeout(lease.release(), CLEANUP_TIMEOUT_MS, 'render benchmark lease cleanup');
  } catch (error) {
    releaseError = error;
  }
  if (benchmarkError || cleanupError || releaseError) {
    throw new AggregateError(
      [benchmarkError, cleanupError, releaseError].filter((error) => error !== undefined),
      'render benchmark or resource cleanup failed',
    );
  }
}

await main();
