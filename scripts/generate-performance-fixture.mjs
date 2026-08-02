import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';
import { cityCounts, setupPerformanceCity } from './performance-scenario.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index].replace(/^--/, ''), process.argv[index + 1]);
}
const canonicalOutput = resolve('benchmarks/fixtures/performance-city-save.json');
const output = resolve(
  args.get('output') ?? 'output/performance/performance-city-save-candidate.json',
);
const targetsCanonicalFixture = process.platform === 'win32'
  ? output.toLowerCase() === canonicalOutput.toLowerCase()
  : output === canonicalOutput;
if (targetsCanonicalFixture && args.get('allow-canonical-overwrite') !== 'true') {
  throw new Error(
    `refusing to overwrite SHA-pinned fixture "${output}"; generate a candidate under output/ `
    + 'and re-earn the fixture, shared contract, tests, and evidence together, or pass '
    + '--allow-canonical-overwrite true for that reviewed change',
  );
}
const seed = Number(args.get('seed') ?? 12345);
const ticks = Number(args.get('ticks') ?? 1200);
if (!Number.isSafeInteger(seed)) {
  throw new Error(`--seed must be a safe integer; received "${args.get('seed')}"`);
}
if (!Number.isSafeInteger(ticks) || ticks < 1) {
  throw new Error(`--ticks must be a safe integer above 0; received "${args.get('ticks')}"`);
}

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'error',
  root: process.cwd(),
  server: { middlewareMode: true },
});

try {
  const [{ createCitySim }, { CITY_WORKER_SIM_FLAGS }] = await Promise.all([
    vite.ssrLoadModule('/src/sim/city.ts'),
    vite.ssrLoadModule('/src/worker/sim-config.ts'),
  ]);
  const sim = createCitySim({ seed, ...CITY_WORKER_SIM_FLAGS });
  setupPerformanceCity(sim);
  for (let index = 0; index < ticks; index++) sim.world.step();
  const save = {
    meta: { saveVersion: 1, seed },
    snapshot: sim.world.serialize(),
  };
  const serialized = JSON.stringify(save);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serialized, 'utf8');
  console.log(JSON.stringify({
    output,
    sha256: createHash('sha256').update(serialized).digest('hex'),
    ...cityCounts(sim),
  }, null, 2));
} finally {
  await vite.close();
}
