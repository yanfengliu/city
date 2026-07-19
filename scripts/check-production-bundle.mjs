import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// Raised 120k → 132k on 2026-07-17 for the T1 traffic realism sim (headway
// lanes, signal stop lines, spawn gaps), then 132k → 142k on 2026-07-18 for
// citizen depth (the happiness model and its explanatory labels, free-time
// activity selection, and the on-demand citizen-detail query), then 142k →
// 150k on 2026-07-19 for persistent three-person profiles, rare-write life
// histories, and generation-safe person/home inspection. The budget still
// exists to catch accidental bloat and recorder leakage, not to freeze the sim.
const MAX_WORKER_BYTES = 150_000;
const FORBIDDEN_RECORDER_STRINGS = ['SessionRecorder', 'MemorySink', 'city-playtest-recorder'];

const assetsDir = resolve('dist/assets');
const workerFiles = (await readdir(assetsDir)).filter((name) => /^sim\.worker-.*\.js$/.test(name));
if (workerFiles.length !== 1) {
  throw new Error(`expected one production sim worker, found ${workerFiles.length}`);
}

const workerPath = resolve(assetsDir, workerFiles[0]);
const [source, workerStat] = await Promise.all([
  readFile(workerPath, 'utf8'),
  stat(workerPath),
]);
const leaked = FORBIDDEN_RECORDER_STRINGS.filter((term) => source.includes(term));
if (leaked.length > 0) {
  throw new Error(`production sim worker retained recorder code: ${leaked.join(', ')}`);
}
if (workerStat.size > MAX_WORKER_BYTES) {
  throw new Error(
    `production sim worker is ${workerStat.size} bytes; budget is ${MAX_WORKER_BYTES} bytes`,
  );
}

console.log(`production worker budget: ${workerStat.size} / ${MAX_WORKER_BYTES} bytes`);
