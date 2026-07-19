import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { MemorySink, SessionRecorder } from 'civ-engine';
import { createServer } from 'vite';
import { cityCounts, setupPerformanceCity } from './performance-scenario.mjs';

const PROFILE_TICKS = 3_000;
const SOURCE_FILES = [
  'scripts/benchmark-recorder.mjs',
  'scripts/performance-scenario.mjs',
  'package.json',
  'package-lock.json',
  'node_modules/civ-engine/package.json',
];
const SOURCE_TREES = [
  { path: 'src/sim', suffix: '.ts' },
  { path: 'node_modules/civ-engine/dist', suffix: '.js' },
];

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

async function filesInTree(root, suffix) {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(resolve(directory), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && path.endsWith(suffix)) files.push(path);
    }
  };
  await visit(root);
  return files;
}

async function sourceManifest() {
  const sourceFiles = [...SOURCE_FILES];
  for (const tree of SOURCE_TREES) {
    sourceFiles.push(...await filesInTree(tree.path, tree.suffix));
  }
  sourceFiles.sort((a, b) => a.localeCompare(b));
  const files = [];
  for (const file of sourceFiles) {
    const bytes = await readFile(resolve(file));
    files.push({
      path: file,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return {
    treeSha256: createHash('sha256')
      .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''))
      .digest('hex'),
    files,
  };
}

function aggregate(runs, label) {
  const selected = runs.filter((run) => run.label === label);
  const mean = (select) => selected.reduce((sum, run) => sum + select(run), 0) / selected.length;
  return {
    runs: selected.length,
    meanWallMs: mean((run) => run.wallMs),
    meanTicksPerSecond: mean((run) => run.ticksPerSecond),
    meanBundleJsonBytes: mean((run) => run.bundleJsonBytes),
  };
}

const args = parseArgs(process.argv.slice(2));
const outputPath = resolve(
  args.get('output') ?? 'benchmarks/results/2026-07-19-recorder-profile.json',
);
const vite = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'error',
  root: process.cwd(),
  server: { middlewareMode: true },
});
const runs = [];
const order = ['recorded', 'lean', 'lean', 'recorded'];

try {
  const { createCitySim } = await vite.ssrLoadModule('/src/sim/city.ts');
  for (let sequence = 0; sequence < order.length; sequence++) {
    const label = order[sequence];
    console.log(`recorder phase ${sequence + 1}/${order.length}: ${label}`);
    const sim = createCitySim({ seed: 3, fieldsEnabled: true });
    sim.world.onDiff(() => {});
    const recorder = label === 'recorded'
      ? new SessionRecorder({ world: sim.world, sink: new MemorySink() })
      : null;
    recorder?.connect();
    setupPerformanceCity(sim);
    const start = performance.now();
    for (let tick = 0; tick < PROFILE_TICKS; tick++) sim.world.step();
    const wallMs = performance.now() - start;
    recorder?.disconnect();
    const bundleJsonBytes = recorder
      ? Buffer.byteLength(JSON.stringify(recorder.toBundle()))
      : 0;
    const run = {
      label,
      sequence: sequence + 1,
      wallMs,
      ticksPerSecond: PROFILE_TICKS * 1_000 / wallMs,
      bundleJsonBytes,
      final: cityCounts(sim),
    };
    runs.push(run);
    console.log(
      `phase ${sequence + 1} wall=${wallMs.toFixed(2)}ms bundle=${bundleJsonBytes}B`,
    );
  }
} finally {
  await vite.close();
}

const recorded = aggregate(runs, 'recorded');
const lean = aggregate(runs, 'lean');
const result = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  profileTicks: PROFILE_TICKS,
  runOrder: order,
  scope: 'Controlled headless sim-loop proxy: one protocol-like no-op diff listener in both modes; SessionRecorder + MemorySink only in recorded mode.',
  sourceRef: args.get('source-ref') ?? null,
  source: await sourceManifest(),
  host: {
    node: process.version,
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
  },
  aggregate: {
    recorded,
    lean,
    wallMsReduction: recorded.meanWallMs - lean.meanWallMs,
    wallMsReductionPct: (recorded.meanWallMs - lean.meanWallMs) * 100 / recorded.meanWallMs,
    throughputGain: lean.meanTicksPerSecond / recorded.meanTicksPerSecond,
  },
  runs,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result.aggregate, null, 2));
console.log(`raw recorder profile: ${relative(process.cwd(), outputPath)}`);
