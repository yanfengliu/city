import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { manifestDirectory, manifestPaths } from './frame-pacing-manifest.mjs';
import { acquireLoopbackLease, HOST_BENCHMARK_LEASE_PORT, LEASE_OWNER_READ_TIMEOUT_MS } from './frame-pacing-lease.mjs';
import { cleanupBrowserResources } from './frame-pacing-browser-lifecycle.mjs';
import { serveDist } from './frame-pacing-http.mjs';
import {
  assertFreshBuildOutput,
  assertStableTree,
  freshBuildGateAccepted,
  maximumConsecutiveAbove,
  parseNamedArgs,
  simulationAccepted,
  superviseChildTree,
  summarize,
  terminateProcessTree,
  waitForChild,
  withTimeout,
} from './frame-pacing-support.mjs';
const VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const DEVICE_PIXEL_RATIOS = [1, 2];
const SPEEDS = [0, 1, 4];
const SAMPLE_FRAMES = 600;
const SETTLE_MS = 1_200;
const MEASUREMENT_TIMEOUT_MS = 30_000;
const MEASUREMENT_WALL_TIMEOUT_MS = 45_000;
const BUILD_TIMEOUT_MS = 120_000;
const CLEANUP_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 30_000;
const CASE_TIMEOUT_MS = 90_000;
const MAX_EXPECTED_RENDER_PIXEL_RATIO = 1.5;
const EXPECTED_FIXTURE_SEED = 12_345;
const EXPECTED_FIXTURE_SHA256 = '2f4823cfb03bd38deea97a3b6aae0491c1ca97b9aa6b60c1c8e582285190c7ec';
const EXPECTED_STATE = Object.freeze({
  tick: 1203,
  populationPeople: 936,
  buildingCount: 453,
  vehiclesOnScreen: 88,
});
const ACCEPTANCE = Object.freeze({
  minimumMeanFps: 58,
  maximumP95IntervalMs: 18.5,
  maximumP99IntervalMs: 25,
  maximumConsecutiveMissedFrames: 2,
  missedFrameMs: 20,
  minimumTickRateBySpeed: Object.freeze({ 1: 18, 4: 72 }),
});
const SOURCE_PATHS = [
  'index.html',
  'package.json',
  'package-lock.json',
  'scripts/benchmark-frame-pacing.mjs',
  'scripts/frame-pacing-browser-lifecycle.d.mts',
  'scripts/frame-pacing-browser-lifecycle.mjs',
  'scripts/frame-pacing-http.d.mts',
  'scripts/frame-pacing-http.mjs',
  'scripts/frame-pacing-lease.d.mts',
  'scripts/frame-pacing-lease.mjs',
  'scripts/frame-pacing-manifest.d.mts',
  'scripts/frame-pacing-manifest.mjs',
  'scripts/frame-pacing-support.d.mts',
  'scripts/frame-pacing-support.mjs',
  'scripts/check-production-bundle.mjs',
  'src',
  'tsconfig.json',
  'vite.config.ts',
  'node_modules/civ-engine/package.json',
  'node_modules/civ-engine/dist',
];

async function buildProduction() {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd', 'run', 'build']
    : ['run', 'build'];
  const child = spawn(command, commandArgs, {
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    windowsHide: true,
  });
  const completion = waitForChild(child, {
    timeoutMs: BUILD_TIMEOUT_MS,
    label: 'production build',
    onTimeout: () => terminateProcessTree(child, { timeoutMs: CLEANUP_TIMEOUT_MS }),
  });
  await superviseChildTree(child, completion, {
    terminate: () => terminateProcessTree(child, { timeoutMs: CLEANUP_TIMEOUT_MS }),
    onTerminationError: (error) => console.error('build tree termination failed', error),
  });
}

async function loadFixture(page, url, fixture) {
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
      set: (value) => {
        game = value;
        value.setSpeed(0);
      },
    });
  }, { save: fixture });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(({ expected }) => {
      if (typeof window.render_game_to_text !== 'function') return false;
      const state = JSON.parse(window.render_game_to_text());
      return state.ready
        && state.speed === 0
        && state.buildingCount === expected.buildingCount;
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
    throw new Error(
      `frame-pacing fixture did not settle: ${String(error)}\n`
      + JSON.stringify({ diagnostic, errors }),
    );
  }
  await page.evaluate(() => window.advanceTime(50));
  await page.waitForFunction(({ expected }) => {
    const state = JSON.parse(window.render_game_to_text());
    return state.tick === expected.tick
      && state.populationPeople === expected.populationPeople
      && state.vehiclesOnScreen === expected.vehiclesOnScreen;
  }, { expected: EXPECTED_STATE }, { timeout: 30_000 });
  return errors;
}

async function measureCase(browser, serverUrl, fixture, devicePixelRatio, speed) {
  const context = await browser.newContext({
    deviceScaleFactor: devicePixelRatio,
    viewport: VIEWPORT,
  });
  let errors;
  let measured;
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    errors = await loadFixture(page, serverUrl, fixture);
    measured = await withTimeout(page.evaluate(async ({
      measurementTimeoutMs,
      sampleFrames,
      settleMs,
      speedValue,
    }) => {
      const game = window.__game;
      const cityScene = game.scene;
      const renderer = cityScene.renderer;
      game.setSpeed(speedValue);
      await new Promise((resolveWait) => setTimeout(resolveWait, settleMs));
      const startState = JSON.parse(window.render_game_to_text());
      const intervals = [];
      const mainThreadFrameDurationsMs = [];
      const pixelRatios = [];
      const drawCalls = [];
      const triangles = [];
      const longTaskDurationsMs = [];
      const longTaskObserver = PerformanceObserver.supportedEntryTypes.includes('longtask')
        ? new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTaskDurationsMs.push(entry.duration);
          })
        : null;
      longTaskObserver?.observe({ type: 'longtask' });
      const originalRenderFrame = cityScene.renderFrame;
      let lastFrameAt;
      try {
        await new Promise((resolveFrames, rejectFrames) => {
          let settled = false;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) rejectFrames(error);
            else resolveFrames();
          };
          const timeout = setTimeout(() => {
            finish(new Error(
              `timed out after ${measurementTimeoutMs}ms with ${intervals.length}/${sampleFrames} frames`,
            ));
          }, measurementTimeoutMs);
          cityScene.renderFrame = function measuredRenderFrame() {
            const startedAt = performance.now();
            const interval = lastFrameAt === undefined ? null : startedAt - lastFrameAt;
            lastFrameAt = startedAt;
            try {
              originalRenderFrame.call(this);
            } catch (error) {
              finish(error instanceof Error ? error : new Error(String(error)));
              return;
            }
            if (interval === null || settled) return;
            intervals.push(interval);
            mainThreadFrameDurationsMs.push(performance.now() - startedAt);
            pixelRatios.push(renderer.getPixelRatio());
            drawCalls.push(renderer.info.render.calls);
            triangles.push(renderer.info.render.triangles);
            if (intervals.length === sampleFrames) finish();
          };
        });
        const endState = JSON.parse(window.render_game_to_text());
        const gl = renderer.getContext();
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          browser: navigator.userAgent,
          webglRenderer: debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
          cssViewport: [innerWidth, innerHeight],
          canvasBuffer: [renderer.domElement.width, renderer.domElement.height],
          renderPixelRatios: [...new Set(pixelRatios)],
          pixelRatioSamples: pixelRatios,
          draw: { ...renderer.info.render },
          drawCalls,
          triangles,
          startState,
          endState,
          sampleElapsedMs: intervals.reduce((sum, value) => sum + value, 0),
          intervals,
          mainThreadFrameDurationsMs,
          longTaskDurationsMs,
        };
      } finally {
        longTaskObserver?.disconnect();
        cityScene.renderFrame = originalRenderFrame;
        game.setSpeed(0);
      }
    }, {
      measurementTimeoutMs: MEASUREMENT_TIMEOUT_MS,
      sampleFrames: SAMPLE_FRAMES,
      settleMs: SETTLE_MS,
      speedValue: speed,
    }), MEASUREMENT_WALL_TIMEOUT_MS, `DPR ${devicePixelRatio} speed ${speed}x measurement`);
  } finally {
    await withTimeout(context.close(), CLEANUP_TIMEOUT_MS, 'browser context cleanup');
  }

  const interval = summarize(measured.intervals);
  const mainThreadFrame = summarize(measured.mainThreadFrameDurationsMs);
  const meanFps = 1000 / interval.mean;
  const maxConsecutiveMissedFrames = maximumConsecutiveAbove(
    measured.intervals,
    ACCEPTANCE.missedFrameMs,
  );
  const tickDelta = measured.endState.tick - measured.startState.tick;
  const tickRate = tickDelta * 1000 / measured.sampleElapsedMs;
  const minimumTickRate = ACCEPTANCE.minimumTickRateBySpeed[speed] ?? 0;
  const simulationGateAccepted = simulationAccepted({
    speed,
    startSpeed: measured.startState.speed,
    endSpeed: measured.endState.speed,
    tickDelta,
    tickRate,
    minimumTickRate,
  });
  const expectedPixelRatio = Math.min(devicePixelRatio, MAX_EXPECTED_RENDER_PIXEL_RATIO);
  const expectedCanvasBuffer = [
    Math.round(VIEWPORT.width * expectedPixelRatio),
    Math.round(VIEWPORT.height * expectedPixelRatio),
  ];
  const qualityAccepted =
    measured.renderPixelRatios.length === 1
    && measured.renderPixelRatios[0] === expectedPixelRatio
    && measured.cssViewport[0] === VIEWPORT.width
    && measured.cssViewport[1] === VIEWPORT.height
    && measured.canvasBuffer[0] === expectedCanvasBuffer[0]
    && measured.canvasBuffer[1] === expectedCanvasBuffer[1];
  const accepted =
    meanFps >= ACCEPTANCE.minimumMeanFps
    && interval.p95 <= ACCEPTANCE.maximumP95IntervalMs
    && interval.p99 <= ACCEPTANCE.maximumP99IntervalMs
    && maxConsecutiveMissedFrames <= ACCEPTANCE.maximumConsecutiveMissedFrames
    && simulationGateAccepted
    && qualityAccepted
    && errors.length === 0;
  return {
    devicePixelRatio,
    speed,
    accepted,
    meanFps,
    frameBudgetHitPct:
      measured.intervals.filter((value) => value <= ACCEPTANCE.maximumP95IntervalMs).length
      * 100 / measured.intervals.length,
    maxConsecutiveMissedFrames,
    simulation: { accepted: simulationGateAccepted, tickDelta, tickRate, minimumTickRate },
    quality: { accepted: qualityAccepted, expectedPixelRatio, expectedCanvasBuffer },
    errors,
    ...measured,
    intervalMs: interval,
    mainThreadFrameMs: mainThreadFrame,
    longTasks: {
      count: measured.longTaskDurationsMs.length,
      totalMs: measured.longTaskDurationsMs.reduce((sum, value) => sum + value, 0),
      maxMs: Math.max(0, ...measured.longTaskDurationsMs),
    },
    drawCall: summarize(measured.drawCalls),
    triangle: summarize(measured.triangles),
  };
}

async function runBenchmark(args) {
  const distDirectory = resolve(args.get('dist') ?? 'dist');
  const shouldBuild = args.get('build') !== 'false';
  assertFreshBuildOutput(shouldBuild, distDirectory, resolve('dist'));
  const fixturePath = resolve(
    args.get('fixture') ?? 'benchmarks/fixtures/performance-city-save.json',
  );
  const outputPath = resolve(args.get('output') ?? 'output/performance/frame-pacing.json');
  const fixture = await readFile(fixturePath, 'utf8');
  const fixtureSha256 = createHash('sha256').update(fixture).digest('hex');
  if (fixtureSha256 !== EXPECTED_FIXTURE_SHA256) {
    throw new Error(
      `fixture SHA ${fixtureSha256} is not canonical ${EXPECTED_FIXTURE_SHA256}`,
    );
  }
  const parsedFixture = JSON.parse(fixture);
  if (parsedFixture?.meta?.seed !== EXPECTED_FIXTURE_SEED) {
    throw new Error(
      `fixture seed ${String(parsedFixture?.meta?.seed)} is not ${EXPECTED_FIXTURE_SEED}`,
    );
  }
  const sourceBeforeBuild = await manifestPaths(SOURCE_PATHS);
  if (shouldBuild) await buildProduction();
  const source = await manifestPaths(SOURCE_PATHS);
  assertStableTree(
    sourceBeforeBuild.treeSha256,
    source.treeSha256,
    'production source changed during the frame-pacing build',
  );
  const binary = await manifestDirectory(distDirectory);

  const cases = [];
  let server;
  let browser;
  let browserServer;
  let runError;
  let cleanupError;
  try {
    server = await serveDist(distDirectory);
    browserServer = await chromium.launchServer({
      channel: args.get('browser-channel') ?? 'chrome',
      headless: true,
      timeout: CONNECT_TIMEOUT_MS,
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    console.log(`frame pacing browser PID ${browserServer.process().pid} (task-owned)`);
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: CONNECT_TIMEOUT_MS });
    for (const devicePixelRatio of DEVICE_PIXEL_RATIOS) {
      for (const speed of SPEEDS) {
        console.log(`frame pacing: DPR ${devicePixelRatio}, speed ${speed}x`);
        const result = await withTimeout(
          measureCase(browser, server.url, fixture, devicePixelRatio, speed),
          CASE_TIMEOUT_MS,
          `DPR ${devicePixelRatio} speed ${speed}x case`,
        );
        cases.push(result);
        console.log(
          `  ${result.meanFps.toFixed(2)} fps, p95=${result.intervalMs.p95.toFixed(2)}ms, `
          + `p99=${result.intervalMs.p99.toFixed(2)}ms, accepted=${result.accepted}`,
        );
      }
    }
  } catch (error) {
    runError = error;
  } finally {
    try {
      await cleanupBrowserResources({
        browser,
        browserServer,
        httpServers: server ? [server] : [],
        cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
      });
    } catch (error) {
      cleanupError = error;
    }
  }
  if (runError || cleanupError) {
    throw new AggregateError(
      [runError, cleanupError].filter((error) => error !== undefined),
      'frame-pacing benchmark failed',
    );
  }
  const binaryAfter = await manifestDirectory(distDirectory);
  assertStableTree(
    binary.treeSha256,
    binaryAfter.treeSha256,
    'served dist changed during frame-pacing measurement',
  );
  const sourceAfter = await manifestPaths(SOURCE_PATHS);
  assertStableTree(
    source.treeSha256,
    sourceAfter.treeSha256,
    'production source changed during frame-pacing measurement',
  );

  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    fixture: {
      path: relative(process.cwd(), fixturePath).replaceAll('\\', '/'),
      sha256: fixtureSha256,
      seed: EXPECTED_FIXTURE_SEED,
      expectedState: EXPECTED_STATE,
    },
    source,
    binary,
    dependencies: {
      civEngineVersion: JSON.parse(
        await readFile('node_modules/civ-engine/package.json', 'utf8'),
      ).version,
    },
    host: {
      node: process.version,
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model ?? 'unknown',
    },
    viewport: VIEWPORT,
    sampleFrames: SAMPLE_FRAMES,
    settleMs: SETTLE_MS,
    measurementTimeoutMs: MEASUREMENT_TIMEOUT_MS,
    measurementWallTimeoutMs: MEASUREMENT_WALL_TIMEOUT_MS,
    buildTimeoutMs: BUILD_TIMEOUT_MS,
    cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    caseTimeoutMs: CASE_TIMEOUT_MS,
    productionBuild: shouldBuild ? 'npm run build' : 'skipped',
    acceptance: ACCEPTANCE,
    measurementAccepted: cases.every((entry) => entry.accepted),
    accepted: freshBuildGateAccepted(shouldBuild, cases),
    cases,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${relative(process.cwd(), outputPath)}; accepted=${result.accepted}`);
  if (!result.accepted) process.exitCode = 1;
}

async function main() {
  const args = parseNamedArgs(process.argv.slice(2));
  const owner = {
    pid: process.pid,
    capturedAt: new Date().toISOString(),
    purpose: 'exclusive host frame-pacing benchmark',
  };
  const lease = await acquireLoopbackLease({
    host: '127.0.0.1',
    port: HOST_BENCHMARK_LEASE_PORT,
    owner,
    ownerReadTimeoutMs: LEASE_OWNER_READ_TIMEOUT_MS,
  });
  console.log(`frame pacing lease ${lease.port} owned by PID ${owner.pid}`);
  let benchmarkError;
  let releaseError;
  try {
    await runBenchmark(args);
  } catch (error) {
    benchmarkError = error;
  }
  try {
    await withTimeout(lease.release(), CLEANUP_TIMEOUT_MS, 'benchmark lease cleanup');
  } catch (error) {
    releaseError = error;
  }
  if (benchmarkError || releaseError) {
    throw new AggregateError(
      [benchmarkError, releaseError].filter((error) => error !== undefined),
      'frame-pacing benchmark or lease cleanup failed',
    );
  }
}

await main();
