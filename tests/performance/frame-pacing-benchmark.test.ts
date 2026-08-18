import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  manifestDirectory,
  manifestPaths,
} from '../../scripts/frame-pacing-manifest.mjs';
import {
  framePacingSourcePaths,
  linkedProductionDependencyNames,
} from '../../scripts/frame-pacing-source-paths.mjs';

const benchmarkSource = readFileSync('scripts/benchmark-frame-pacing.mjs', 'utf8');
const browserLifecycleSource = readFileSync(
  'scripts/frame-pacing-browser-lifecycle.mjs',
  'utf8',
);
const httpSource = readFileSync('scripts/frame-pacing-http.mjs', 'utf8');
const leaseSource = readFileSync('scripts/frame-pacing-lease.mjs', 'utf8');
const manifestSource = readFileSync('scripts/frame-pacing-manifest.mjs', 'utf8');
const fixtureContractSource = readFileSync(
  'scripts/performance-fixture-contract.mjs',
  'utf8',
);
const recorderSourceManifestSource = readFileSync(
  'scripts/recorder-source-manifest.mjs',
  'utf8',
);
const supportSource = readFileSync('scripts/frame-pacing-support.mjs', 'utf8');
const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>;
};
const source = [
  benchmarkSource,
  browserLifecycleSource,
  httpSource,
  leaseSource,
  manifestSource,
  fixtureContractSource,
  recorderSourceManifestSource,
  supportSource,
].join('\n');

describe('frame-pacing benchmark contract', () => {
  it('builds before serving and owns browser/server cleanup', () => {
    expect(benchmarkSource).toContain('schemaVersion: 2');
    expect(benchmarkSource).toContain("from './frame-pacing-support.mjs'");
    expect(source).toContain("await buildProduction()");
    expect(source).toContain("source changed during the frame-pacing build");
    expect(source).toContain("source changed during frame-pacing measurement");
    expect(source).toContain("SOURCE_NORMALIZATION = 'crlf-to-lf'");
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

  it('fingerprints every linked production dependency through the real source list', () => {
    const names = linkedProductionDependencyNames(packageMetadata);
    const paths = framePacingSourcePaths(packageMetadata);
    const expectedNames = Object.entries(packageMetadata.dependencies ?? {})
      .filter(([, version]) => version.startsWith('file:'))
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right));

    expect(names).toEqual(expectedNames);
    expect(names).toEqual(['civ-engine', 'voxel']);
    expect(paths).toContain('.gitattributes');
    expect(paths).toContain('scripts/recorder-source-manifest.mjs');
    expect(paths).toContain('scripts/frame-pacing-source-paths.mjs');
    expect(paths).toContain('scripts/performance-fixture-contract.mjs');
    for (const name of names) {
      expect(paths).toContain(`node_modules/${name}/package.json`);
      expect(paths).toContain(`node_modules/${name}/dist`);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps checkout line endings outside the production source identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'city-frame-source-'));
    const path = join(directory, 'example.ts');
    try {
      writeFileSync(path, 'const value = 1;\nexport { value };\n');
      const lf = await manifestPaths([path]);
      writeFileSync(path, 'const value = 1;\r\nexport { value };\r\n');
      const crlf = await manifestPaths([path]);
      writeFileSync(path, 'const value = 1;\r\nexport { value };\n');
      const mixed = await manifestPaths([path]);
      writeFileSync(path, 'const value = 2;\nexport { value };\n');
      const changed = await manifestPaths([path]);

      expect(lf.normalization).toBe('crlf-to-lf');
      expect(crlf).toEqual(lf);
      expect(mixed).toEqual(lf);
      expect(changed.treeSha256).not.toBe(lf.treeSha256);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the served production bundle on raw-byte identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'city-frame-binary-'));
    const path = join(directory, 'bundle.js');
    try {
      writeFileSync(path, 'const value = 1;\n');
      const lf = await manifestDirectory(directory);
      writeFileSync(path, 'const value = 1;\r\n');
      const crlf = await manifestDirectory(directory);

      expect('normalization' in lf).toBe(false);
      expect(crlf.treeSha256).not.toBe(lf.treeSha256);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
    expect(source).toContain('vehiclesOnScreen: 77');
    expect(source).toContain('pedestriansOnScreen: 2');
    expect(source).toContain('frame-pacing fixture state mismatch after advance');
    expect(source).toContain('actualState');
    expect(benchmarkSource.indexOf('window.advanceTime(50)')).toBeLessThan(
      benchmarkSource.indexOf('actualState.populationPeople !== EXPECTED_STATE.populationPeople'),
    );
    expect(source).toContain(
      'actualState.pedestriansOnScreen !== EXPECTED_STATE.pedestriansOnScreen',
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
