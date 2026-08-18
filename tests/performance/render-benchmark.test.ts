// Bare specifier on purpose: vite.config.ts aliases the node:* form to a browser shim.
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { PERFORMANCE_FIXTURE_POST_ADVANCE_STATE } from '../../scripts/performance-fixture-contract.mjs';

const benchmarkSource = readFileSync('scripts/benchmark-render.mjs', 'utf8');

describe('render benchmark contract', () => {
  it('pins the renderer to equal DPR-1 buffers before A/B sampling', () => {
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
    expect(benchmarkSource).toContain('PERFORMANCE_FIXTURE_POST_ADVANCE_STATE');
    expect(benchmarkSource).toContain(
      'actualState.pedestriansOnScreen !== EXPECTED_STATE.pedestriansOnScreen',
    );
    expect(benchmarkSource).toContain(
      'JSON.stringify({ expectedState: EXPECTED_STATE, actualState, pageErrors })',
    );
    expect(PERFORMANCE_FIXTURE_POST_ADVANCE_STATE).toMatchObject({
      vehiclesOnScreen: 77,
      pedestriansOnScreen: 2,
    });
    expect(benchmarkSource).toContain('lease.release()');
    expect(benchmarkSource).toContain('page.close()');
  });

  it('keeps raw A-B-B-A results in ignored local output', () => {
    expect(benchmarkSource).toContain('const WARMUP_FRAMES = 1_800');
    expect(benchmarkSource).toContain('const SAMPLE_FRAMES = 600');
    expect(benchmarkSource).toContain("['before', beforeServer.url]");
    expect(benchmarkSource).toContain("['after', afterServer.url]");
    expect(benchmarkSource).toContain('runOrder: order.map(([label]) => label)');
    expect(benchmarkSource).toContain("'output/performance/render-benchmark.json'");
    expect(benchmarkSource).toContain('await mkdir(dirname(outputPath), { recursive: true })');
    expect(benchmarkSource).toContain('await writeFile(outputPath');
    expect(benchmarkSource).not.toContain('benchmarks/results/');
  });
});
