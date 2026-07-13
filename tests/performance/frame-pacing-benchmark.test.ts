import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const benchmarkSource = readFileSync('scripts/benchmark-frame-pacing.mjs', 'utf8');
const browserLifecycleSource = readFileSync(
  'scripts/frame-pacing-browser-lifecycle.mjs',
  'utf8',
);
const httpSource = readFileSync('scripts/frame-pacing-http.mjs', 'utf8');
const leaseSource = readFileSync('scripts/frame-pacing-lease.mjs', 'utf8');
const manifestSource = readFileSync('scripts/frame-pacing-manifest.mjs', 'utf8');
const supportSource = readFileSync('scripts/frame-pacing-support.mjs', 'utf8');
const source = [
  benchmarkSource,
  browserLifecycleSource,
  httpSource,
  leaseSource,
  manifestSource,
  supportSource,
].join('\n');

describe('frame-pacing benchmark contract', () => {
  it('builds before serving and owns browser/server cleanup', () => {
    expect(benchmarkSource).toContain("from './frame-pacing-support.mjs'");
    expect(source).toContain("await buildProduction()");
    expect(source).toContain("source changed during the frame-pacing build");
    expect(source).toContain("source changed during frame-pacing measurement");
    expect(source).toContain("node_modules/civ-engine/dist");
    expect(source).toContain("custom --dist requires --build false");
    expect(source).toContain("headless: true");
    expect(source).toContain("chromium.launchServer");
    expect(source).toContain('acquireLoopbackLease');
    expect(source).toContain('HOST_BENCHMARK_LEASE_PORT');
    expect(source).toContain('lease.release()');
    expect(source).toContain("browserServer.process().pid");
    expect(source).toContain('cleanupBrowserResources');
    expect(source).toContain("Promise.allSettled");
    expect(source).toContain("context.close()");
  });

  it('bounds frame collection and proves active simulation throughput', () => {
    expect(source).toContain('MEASUREMENT_TIMEOUT_MS = 30_000');
    expect(source).toContain('MEASUREMENT_WALL_TIMEOUT_MS = 45_000');
    expect(source).toContain('BUILD_TIMEOUT_MS = 120_000');
    expect(source).toContain("'taskkill'");
    expect(source).toContain("detached: process.platform !== 'win32'");
    expect(source).toContain('timed out after');
    expect(source).toContain('minimumTickRateBySpeed');
    expect(source).toContain('EXPECTED_FIXTURE_SHA256');
    expect(source).toContain('populationPeople: 936');
    expect(source).toContain('state.populationPeople === expected.populationPeople');
    expect(benchmarkSource.indexOf('window.advanceTime(50)')).toBeLessThan(
      benchmarkSource.indexOf('state.populationPeople === expected.populationPeople'),
    );
    expect(source).toContain('is not canonical');
    expect(source).toContain('tickRate >= minimumTickRate');
    expect(source).toContain('tickDelta === 0');
    expect(source).toContain('qualityAccepted');
    expect(source).toContain('expectedCanvasBuffer');
    expect(source).toContain('renderPixelRatios.length === 1');
    expect(source).toContain('pixelRatioSamples: pixelRatios');
    expect(source).toContain('drawCalls.push');
    expect(source).toContain("supportedEntryTypes.includes('longtask')");
    expect(source).toContain('longTaskDurationsMs');
  });
});
