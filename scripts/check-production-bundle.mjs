import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_WORKER_BYTES = 120_000;
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
