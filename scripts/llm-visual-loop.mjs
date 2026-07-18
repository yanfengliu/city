// city llm-visual-loop: autonomous player-surface playtest over window.__harness.
//
// Boots the vite dev server + headless Chromium, proxies civ-engine's
// runVisualPlaytestLoop through the in-page visual host (real pointer/keyboard
// events — never the command() backdoor), and persists a replayable session
// bundle + findings + a validated improvement run manifest per run under
// output/playtests-llm/<stamp>/, appending each manifest to ledger.jsonl.
//
// Default agent is a deterministic scripted bootstrapper (road + zones +
// power) so the command runs without API keys. Set CITY_LLM_VISUAL_LOOP_COMMAND
// to plug in an LLM: the command receives {step, promptParts, controls} JSON on
// stdin (promptParts from civ-engine buildVisualPlaytestPromptParts — text
// parts plus the screenshot image part) and must print a decision JSON
// ({action}|{actions}, optional findings, optional stopReason) on stdout.
//
// Env: CITY_VISUAL_LOOP_STEPS (default 24), CITY_VISUAL_LOOP_WALL_CLOCK_MS
// (default 300000), CITY_PLAYTEST_URL (reuse an existing server).

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import {
  buildVisualPlaytestPromptParts,
  createImprovementRunManifest,
  runVisualPlaytestLoop,
} from 'civ-engine';

const cwd = process.cwd();
const maxSteps = boundedNumber(process.env.CITY_VISUAL_LOOP_STEPS, 24, 1, 120);
const maxWallClockMs = boundedNumber(process.env.CITY_VISUAL_LOOP_WALL_CLOCK_MS, 300_000, 10_000, 3_600_000);
const providerCommand = process.env.CITY_LLM_VISUAL_LOOP_COMMAND?.trim() ?? '';
const configuredUrl = process.env.CITY_PLAYTEST_URL?.trim() ?? '';
const outRoot = path.join(cwd, 'output', 'playtests-llm');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(outRoot, stamp);
const ledgerPath = path.join(outRoot, 'ledger.jsonl');

let server;
let browser;
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();

try {
  await fs.mkdir(runDir, { recursive: true });
  if (!configuredUrl) {
    server = await createServer({
      root: cwd,
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 5176, strictPort: false },
    });
    await server.listen();
  }
  const url = new URL(configuredUrl || server?.resolvedUrls?.local?.[0] || 'http://127.0.0.1:5176/');
  url.searchParams.set('record', '1');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__harness), null, { timeout: 30_000 });
  await page.waitForSelector('canvas');

  // Node-side proxy over the in-page visual host: every observe/act crosses
  // the page boundary as JSON, keeping the loop on the real player surface.
  // performAction settles briefly after each action because the harness's
  // advance()/player events post async worker messages — without the settle,
  // the next observation can be stale relative to the completed action.
  const host = {
    observe: () => page.evaluate(() => window.__harness.visualHost().observe()),
    performAction: async (action) => {
      const result = await page.evaluate((a) => window.__harness.visualHost().performAction(a), action);
      await page.waitForTimeout(150);
      return result;
    },
    annotate: (finding) =>
      page.evaluate((f) => {
        window.__harness.visualHost().annotate?.(f);
      }, finding),
  };

  const agent = providerCommand
    ? externalCommandAgent(providerCommand)
    : scriptedBootstrapAgent();

  const result = await runVisualPlaytestLoop({
    host,
    agent,
    maxSteps,
    promptMode: 'oracleAssisted',
    agentObservation: 'redacted',
    onActionFailure: 'continue',
    budget: { maxWallClockMs, maxActionsPerStep: 3, maxActionFailures: 8 },
  });

  // Verify FIRST, then export: the harness selfCheck takes the terminal
  // snapshot, so exporting afterwards persists the exact bundle state the
  // verification covered (a pre-verification export ships snapshot-less,
  // unreplayable JSON that the reported self-check never saw).
  const selfCheck = await page.evaluate(() => window.__harness.selfCheck());
  const exported = await page.evaluate(() => window.__harness.getBundle());
  const checkedSegments = selfCheck?.checkedSegments ?? 0;
  const verification = selfCheck
    ? {
        ok: selfCheck.ok === true && checkedSegments > 0,
        checkedSegments,
        skippedSegments: Array.isArray(selfCheck.skippedSegments)
          ? selfCheck.skippedSegments.length
          : selfCheck.skippedSegments ?? 0,
      }
    : null;

  const bundlePath = path.join(runDir, 'bundle.json');
  await fs.writeFile(bundlePath, `${JSON.stringify(exported.bundle)}\n`);
  await fs.writeFile(path.join(runDir, 'findings.json'), `${JSON.stringify(exported.findings, null, 2)}\n`);
  await fs.writeFile(
    path.join(runDir, 'result.json'),
    `${JSON.stringify({ ok: result.ok, stopReason: result.stopReason, stepsRun: result.stepsRun, loopFindings: result.findings, verification }, null, 2)}\n`,
  );

  const sessionId = exported.bundle?.metadata?.sessionId;
  const manifest = createImprovementRunManifest({
    id: `city-visual-loop-${stamp}`,
    gameId: 'city',
    objective: 'Bootstrap and play the city like a real player; record findings.',
    startedAt,
    completedAt: new Date().toISOString(),
    ...(typeof sessionId === 'string' ? { sessionId, bundleId: sessionId } : {}),
    durationMs: Date.now() - startedAtMs,
    stopReason: result.stopReason,
    provider: providerCommand ? 'external-command' : 'scripted',
    artifacts: [
      { kind: 'bundle', path: path.relative(cwd, bundlePath) },
      { kind: 'findings', path: path.relative(cwd, path.join(runDir, 'findings.json')) },
      { kind: 'result', path: path.relative(cwd, path.join(runDir, 'result.json')) },
    ],
    data: {
      verification,
      findingCount: exported.findings.length,
      loopFindingCount: result.findings.length,
    },
  });
  await fs.writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.appendFile(ledgerPath, `${JSON.stringify(manifest)}\n`);

  console.log(JSON.stringify({
    runDir: path.relative(cwd, runDir),
    stopReason: result.stopReason,
    stepsRun: result.stepsRun,
    findings: exported.findings.length,
    selfCheckOk: verification?.ok ?? null,
    checkedSegments: verification?.checkedSegments ?? null,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}

// Deterministic default: bootstrap a tiny city through the player surface —
// road across the map, R/C zones beside it, a coal plant — then watch and stop.
function scriptedBootstrapAgent() {
  return {
    decide({ step, observation }) {
      const canvas = observation.controls?.find((control) => control.id === 'canvas')?.bounds;
      if (!canvas) return { actions: [{ kind: 'wait', durationMs: 500 }] };
      const cx = canvas.x + canvas.width / 2;
      const cy = canvas.y + canvas.height / 2;
      const plan = [
        [{ kind: 'key', key: 'q', reason: 'select road tool' },
          { kind: 'drag', from: { x: cx - 220, y: cy }, to: { x: cx + 220, y: cy }, reason: 'draw main road' }],
        [{ kind: 'key', key: 'r', reason: 'select residential zoning' },
          { kind: 'drag', from: { x: cx - 200, y: cy - 70 }, to: { x: cx - 40, y: cy - 20 }, reason: 'zone homes north of road' }],
        [{ kind: 'key', key: 'c', reason: 'select commercial zoning' },
          { kind: 'drag', from: { x: cx + 40, y: cy - 70 }, to: { x: cx + 200, y: cy - 20 }, reason: 'zone shops north of road' }],
        [{ kind: 'key', key: 'g', reason: 'select coal plant' },
          { kind: 'click', point: { x: cx - 120, y: cy + 90 }, reason: 'place power near the road' }],
        [{ kind: 'key', key: 'l', reason: 'select power line' },
          { kind: 'drag', from: { x: cx - 120, y: cy + 70 }, to: { x: cx - 120, y: cy + 10 }, reason: 'connect plant toward road' }],
      ];
      if (step < plan.length) return { actions: plan[step] };
      if (step < plan.length + 4) {
        return { actions: [{ kind: 'wait', durationMs: 2_000, reason: 'let the city simulate and grow' }] };
      }
      return { actions: [{ kind: 'stop', reason: 'scripted bootstrap complete' }] };
    },
  };
}

function externalCommandAgent(command) {
  return {
    async decide({ step, observation, mode }) {
      const promptParts = buildVisualPlaytestPromptParts({
        observation,
        mode,
        objective: 'Play this city-builder like a real player and report player-facing findings.',
        maxActions: 3,
      });
      const payload = JSON.stringify({ step, promptParts, controls: observation.controls ?? [] });
      const stdout = await runJsonCommand(command, payload);
      const decision = JSON.parse(stdout);
      if (!decision || (typeof decision !== 'object')) {
        throw new Error(
          `provider returned ${decision === null ? 'null' : typeof decision} where a decision `
          + `object was expected; stdout began: ${stdout.slice(0, 200)}`,
        );
      }
      return decision;
    },
  };
}

function runJsonCommand(command, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('provider command timed out after 120000ms'));
    }, 120_000);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`provider command exited ${code}: ${stderr.slice(0, 400)}`));
    });
    child.stdin.write(stdin, 'utf8');
    child.stdin.end();
  });
}

function boundedNumber(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
