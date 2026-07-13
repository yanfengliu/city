// Bare specifiers on purpose: vite.config.ts aliases the node:* forms to browser shims.
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

interface BenchmarkRun {
  label: 'before' | 'after';
  renderMs: number[];
  calls: number[];
  triangles: number[];
  summary: {
    renderMs: { mean: number };
    averageCalls: number;
    averageTriangles: number;
  };
}

interface BenchmarkResult {
  schemaVersion: number;
  runOrder: string[];
  warmupFrames: number;
  sampleFrames: number;
  fixture: { path: string; sha256: string; seed: number; expectedState: object };
  binaries: {
    before: { treeSha256: string; files: { path: string; bytes: number; sha256: string }[] };
    after: { treeSha256: string; files: { path: string; bytes: number; sha256: string }[] };
  };
  aggregate: {
    before: Aggregate;
    after: Aggregate;
    meanRenderMsDelta: number;
    meanRenderMsReductionPct: number;
    drawCallReductionPct: number;
    triangleReductionPct: number;
  };
  runs: BenchmarkRun[];
}

interface Aggregate {
  meanRenderMs: number;
  p50RenderMs: number;
  p95RenderMs: number;
  p99RenderMs: number;
  averageCalls: number;
  averageTriangles: number;
}

const resultText = readFileSync('benchmarks/results/2026-07-12-shadow-cache.json', 'utf8');
const result = JSON.parse(resultText) as BenchmarkResult;
const fixture = readFileSync('benchmarks/fixtures/performance-city-save.json', 'utf8');
const benchmarkSource = readFileSync('scripts/benchmark-render.mjs', 'utf8');

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

describe('committed render benchmark evidence', () => {
  it('pins the renderer to equal DPR-1 buffers before historical A/B sampling', () => {
    expect(benchmarkSource).toContain('renderer.setPixelRatio(1)');
    expect(benchmarkSource).toContain('renderer.setSize(innerWidth, innerHeight, false)');
    expect(benchmarkSource).toContain('does not match fixed viewport');
    expect(benchmarkSource).toContain('HOST_BENCHMARK_LEASE_PORT');
    expect(benchmarkSource).toContain('cleanupBrowserResources');
    expect(benchmarkSource).toContain('chromium.launchServer');
    expect(benchmarkSource).toContain('browserServer.process().pid');
    expect(benchmarkSource).toContain('PHASE_TIMEOUT_MS');
    expect(benchmarkSource).toContain('before bundle changed during GPU render benchmark');
    expect(benchmarkSource).toContain('after bundle changed during GPU render benchmark');
    expect(benchmarkSource).toContain('lease.release()');
    expect(benchmarkSource).toContain('page.close()');
  });

  it('pins the fixture, A-B-B-A protocol, and every raw sample', () => {
    expect(result.schemaVersion).toBe(1);
    expect(result.runOrder).toEqual(['before', 'after', 'after', 'before']);
    expect(result.warmupFrames).toBe(1_800);
    expect(result.sampleFrames).toBe(600);
    expect(result.fixture.path).toBe('benchmarks/fixtures/performance-city-save.json');
    expect(result.fixture.sha256).toBe(createHash('sha256').update(fixture).digest('hex'));
    expect(result.fixture.seed).toBe(12_345);
    expect(result.fixture.expectedState).toEqual({
      tick: 1203,
      buildingCount: 453,
      vehiclesOnScreen: 88,
    });
    expect(result.binaries.before.treeSha256).toBe(
      '5286bcb77ea46878eddca351edb6f0f15c4d89d520bbdc35318754f3ec864f37',
    );
    expect(result.binaries.after.treeSha256).toBe(
      '5e60854ef550280aa50c59e222410b5d285e51abc2b06708f2218b9f2d250a74',
    );
    for (const manifest of [result.binaries.before, result.binaries.after]) {
      expect(manifest.treeSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.files.length).toBeGreaterThanOrEqual(3);
      expect(manifest.files.every((file) => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)))
        .toBe(true);
      const treeInput = manifest.files
        .map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`)
        .join('');
      expect(manifest.treeSha256).toBe(
        createHash('sha256').update(treeInput).digest('hex'),
      );
    }
    expect(result.runs).toHaveLength(4);
    for (const run of result.runs) {
      expect(run.renderMs).toHaveLength(result.sampleFrames);
      expect(run.calls).toHaveLength(result.sampleFrames);
      expect(run.triangles).toHaveLength(result.sampleFrames);
    }
  });

  it('keeps summaries derived from raw runs and contains no local user path', () => {
    for (const label of ['before', 'after'] as const) {
      const runs = result.runs.filter((run) => run.label === label);
      const renderMs = runs.flatMap((run) => run.renderMs);
      expect(result.aggregate[label].meanRenderMs).toBeCloseTo(mean(renderMs), 12);
      expect(result.aggregate[label].p50RenderMs).toBe(percentile(renderMs, 0.5));
      expect(result.aggregate[label].p95RenderMs).toBe(percentile(renderMs, 0.95));
      expect(result.aggregate[label].p99RenderMs).toBe(percentile(renderMs, 0.99));
      expect(result.aggregate[label].averageCalls).toBe(mean(runs.flatMap((run) => run.calls)));
      expect(result.aggregate[label].averageTriangles).toBe(
        mean(runs.flatMap((run) => run.triangles)),
      );
      for (const run of runs) {
        expect(run.summary.renderMs.mean).toBeCloseTo(mean(run.renderMs), 12);
        expect(run.summary.averageCalls).toBe(mean(run.calls));
        expect(run.summary.averageTriangles).toBe(mean(run.triangles));
      }
    }
    const { before, after } = result.aggregate;
    expect(result.aggregate.meanRenderMsDelta).toBeCloseTo(
      after.meanRenderMs - before.meanRenderMs,
      12,
    );
    expect(result.aggregate.meanRenderMsReductionPct).toBeCloseTo(
      (before.meanRenderMs - after.meanRenderMs) * 100 / before.meanRenderMs,
      12,
    );
    expect(result.aggregate.drawCallReductionPct).toBeCloseTo(
      (before.averageCalls - after.averageCalls) * 100 / before.averageCalls,
      12,
    );
    expect(result.aggregate.triangleReductionPct).toBeCloseTo(
      (before.averageTriangles - after.averageTriangles) * 100 / before.averageTriangles,
      12,
    );
    expect(result.aggregate.before.averageCalls).toBe(53);
    expect(result.aggregate.after.averageCalls).toBe(34);
    expect(result.aggregate.before.averageTriangles).toBe(713_931);
    expect(result.aggregate.after.averageTriangles).toBe(394_815);
    expect(resultText).not.toMatch(/[A-Z]:\\Users\\/i);
  });
});
