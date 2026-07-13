import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const WARMUP_FRAMES = 1_800;
const SAMPLE_FRAMES = 600;
const EXPECTED_FIXTURE_SEED = 12345;
const EXPECTED_STATE = Object.freeze({ tick: 1203, buildingCount: 453, vehiclesOnScreen: 88 });

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

function required(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function contentType(filePath) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  }[extname(filePath)] ?? 'application/octet-stream';
}

async function serveDist(directory) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const filePath = resolve(root, relative);
      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error('not a file');
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': contentType(filePath),
      });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('benchmark server has no TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    }),
  };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (percentile) => sorted[Math.floor((sorted.length - 1) * percentile)];
  return {
    samples: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1),
  };
}

function distribution(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

async function distManifest(directory) {
  const root = resolve(directory);
  const files = [];
  const visit = async (relativeDirectory) => {
    const entries = await readdir(resolve(root, relativeDirectory), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile()) {
        const bytes = await readFile(resolve(root, relativePath));
        files.push({
          path: relativePath,
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  };
  await visit('');
  const treeSha256 = createHash('sha256')
    .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''))
    .digest('hex');
  return { treeSha256, files };
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

const args = parseArgs(process.argv.slice(2));
const beforeDir = resolve(required(args, 'before-dir'));
const afterDir = resolve(args.get('after-dir') ?? 'dist');
const fixturePath = resolve(args.get('fixture') ?? 'benchmarks/fixtures/performance-city-save.json');
const outputPath = resolve(args.get('output') ?? 'output/performance/render-benchmark.json');
const browserChannel = args.get('browser-channel') ?? 'chrome';
const fixture = await readFile(fixturePath, 'utf8');
const fixtureSave = JSON.parse(fixture);
if (fixtureSave?.meta?.seed !== EXPECTED_FIXTURE_SEED) {
  throw new Error(
    `fixture seed ${String(fixtureSave?.meta?.seed)} does not match boot terrain seed ${EXPECTED_FIXTURE_SEED}`,
  );
}
const [beforeManifest, afterManifest] = await Promise.all([
  distManifest(beforeDir),
  distManifest(afterDir),
]);
const beforeServer = await serveDist(beforeDir);
const afterServer = await serveDist(afterDir);
const browser = await chromium.launch({
  headless: true,
  channel: browserChannel,
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
const order = [
  ['before', beforeServer.url],
  ['after', afterServer.url],
  ['after', afterServer.url],
  ['before', beforeServer.url],
];
const runs = [];

try {
  for (let index = 0; index < order.length; index++) {
    const [label, url] = order[index];
    console.log(`benchmark phase ${index + 1}/${order.length}: ${label}`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(60_000);
    await loadFixture(page, url, fixture);
    const run = await measure(page, label, index + 1);
    runs.push(run);
    console.log(
      `phase ${index + 1} mean=${run.summary.renderMs.mean.toFixed(4)}ms calls=${run.summary.averageCalls}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await Promise.all([beforeServer.close(), afterServer.close()]);
}

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
    meanRenderMsReductionPct: (before.meanRenderMs - after.meanRenderMs) * 100 / before.meanRenderMs,
    drawCallReductionPct: (before.averageCalls - after.averageCalls) * 100 / before.averageCalls,
    triangleReductionPct:
      (before.averageTriangles - after.averageTriangles) * 100 / before.averageTriangles,
  },
  runs,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result.aggregate, null, 2));
console.log(`raw benchmark: ${outputPath}`);
