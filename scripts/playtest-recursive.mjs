// playtest-recursive: one proposal-only recursive self-improvement pass.
//
// Runs the autonomous loop (which persists bundle/findings/result + a run
// manifest under output/playtests-llm/<stamp>/ and appends ledger.jsonl),
// reads the newest run's findings and verification, selects the top
// fix-classified finding, and writes a pass manifest beside the run. city has
// no auto-apply arm — the driving agent is the fix arm: fix the candidate,
// rerun this command, and compare runs before claiming anything fixed.
//
// Outcomes (manifest stopReason): no-fix-candidate | proposal-only | run-failed.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPassManifest, selectFixCandidate } from './recursive-pass.mjs';

const cwd = process.cwd();
const outRoot = path.join(cwd, 'output', 'playtests-llm');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();

const loop = await runCommand(npmBin, ['run', 'playtest:llm']);
if (loop.exitCode !== 0) {
  await finish(null, 'run-failed', 1);
}

const runDir = await newestRunDir(outRoot, startedAtMs);
if (!runDir) {
  console.error('[recursive] no run directory produced by playtest:llm');
  await finish(null, 'run-failed', 1);
}

let findings = [];
let result = null;
let manifest = null;
try {
  findings = JSON.parse(await fs.readFile(path.join(runDir, 'findings.json'), 'utf8'));
  result = JSON.parse(await fs.readFile(path.join(runDir, 'result.json'), 'utf8'));
  manifest = JSON.parse(await fs.readFile(path.join(runDir, 'manifest.json'), 'utf8'));
} catch (error) {
  console.error(`[recursive] failed to read run artifacts: ${error?.message ?? error}`);
  await finish(runDir, 'run-failed', 1);
}

const candidate = selectFixCandidate(findings);
if (candidate) {
  console.log(`[recursive] fix candidate: ${candidate.id} [${candidate.severity}] ${candidate.title}`);
  console.log('[recursive] city is proposal-only: fix this finding, rerun, and compare before claiming it fixed.');
} else {
  console.log('[recursive] no fix-classified finding in this run');
}
await finish(runDir, undefined, 0, { candidate, result, manifest });

async function finish(runDirPath, forcedOutcome, exitCode, context = {}) {
  const completedAtMs = Date.now();
  const passManifest = buildPassManifest({
    id: `city-recursive-${startedAt.replace(/[:.]/g, '-')}`,
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    provider: context.manifest?.provider,
    sessionId: context.manifest?.sessionId,
    candidate: forcedOutcome ? null : context.candidate ?? null,
    verification: context.result?.verification ?? null,
    forcedOutcome,
    artifacts: runDirPath
      ? [
          { kind: 'run-dir', path: path.relative(cwd, runDirPath) },
          { kind: 'findings', path: path.relative(cwd, path.join(runDirPath, 'findings.json')) },
        ]
      : [],
  });
  if (runDirPath) {
    await fs
      .writeFile(path.join(runDirPath, 'pass-manifest.json'), `${JSON.stringify(passManifest, null, 2)}\n`)
      .catch(() => {});
  }
  await fs.mkdir(outRoot, { recursive: true });
  await fs.appendFile(path.join(outRoot, 'passes.jsonl'), `${JSON.stringify(passManifest)}\n`);
  console.log(JSON.stringify({ outcome: passManifest.stopReason, candidate: context.candidate?.id ?? null }, null, 2));
  process.exit(exitCode);
}

// The loop stamps its run dir from its own clock; take the newest dir created
// at/after this pass started so a concurrent older dir is never misattributed.
async function newestRunDir(root, sinceMs) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && stat.mtimeMs >= sinceMs - 5_000) candidates.push({ full, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.full ?? null;
}

function runCommand(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ exitCode: code ?? -1 }));
  });
}
