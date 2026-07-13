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
const output = resolve(args.get('output') ?? 'benchmarks/fixtures/performance-city-save.json');
const seed = Number(args.get('seed') ?? 12345);
const ticks = Number(args.get('ticks') ?? 1200);
if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(ticks) || ticks < 1) {
  throw new Error('seed and ticks must be safe integers; ticks must be positive');
}

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'error',
  root: process.cwd(),
  server: { middlewareMode: true },
});

try {
  const { createCitySim } = await vite.ssrLoadModule('/src/sim/city.ts');
  const sim = createCitySim({ seed, fieldsEnabled: true });
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
