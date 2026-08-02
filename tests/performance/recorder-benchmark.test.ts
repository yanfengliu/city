import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  finishSourceManifest,
  sourceFileRecord,
} from '../../scripts/recorder-source-manifest.mjs';

interface SourceFile {
  path: string;
  bytes: number;
  sha256: string;
}

interface RecorderRun {
  label: 'recorded' | 'lean';
  sequence: number;
  wallMs: number;
  ticksPerSecond: number;
  bundleJsonBytes: number;
  final: {
    tick: number;
    buildingCount: number;
    vehicles: number;
    pedestrians: number;
    completedShoppingTrips: number;
    populationPeople: number;
  };
}

interface RecorderResult {
  schemaVersion: number;
  profileTicks: number;
  runOrder: string[];
  source: {
    normalization: 'crlf-to-lf';
    treeSha256: string;
    files: SourceFile[];
  };
  aggregate: {
    recorded: Aggregate;
    lean: Aggregate;
    wallMsReduction: number;
    wallMsReductionPct: number;
    throughputGain: number;
  };
  runs: RecorderRun[];
}

interface Aggregate {
  runs: number;
  meanWallMs: number;
  meanTicksPerSecond: number;
  meanBundleJsonBytes: number;
}

// The newest recorder profile. Its manifest must describe the current tree, so
// this points at a freshly captured file whenever a pinned input changes;
// earlier dated profiles stay in results/ as history.
const resultText = readFileSync('benchmarks/results/2026-08-02-recorder-profile.json', 'utf8');
const result = JSON.parse(resultText) as RecorderResult;

function mean(runs: RecorderRun[], select: (run: RecorderRun) => number): number {
  return runs.reduce((sum, run) => sum + select(run), 0) / runs.length;
}

function filesInTree(root: string, suffix: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) return filesInTree(path, suffix);
    return entry.isFile() && path.endsWith(suffix) ? [path] : [];
  });
}

describe('committed recorder benchmark evidence', () => {
  it('pins the measured source tree and alternating protocol', () => {
    expect(result.schemaVersion).toBe(2);
    expect(result.source.normalization).toBe('crlf-to-lf');
    expect(result.profileTicks).toBe(3_000);
    expect(result.runOrder).toEqual(['recorded', 'lean', 'lean', 'recorded']);
    expect(result.runs.map((run) => run.label)).toEqual(result.runOrder);
    expect(result.runs.map((run) => run.sequence)).toEqual([1, 2, 3, 4]);

    const expectedPaths = [
      '.gitattributes',
      'scripts/benchmark-recorder.mjs',
      'scripts/performance-scenario.mjs',
      'scripts/recorder-source-manifest.mjs',
      'package.json',
      'package-lock.json',
      'node_modules/civ-engine/package.json',
      ...filesInTree('src/sim', '.ts'),
      ...filesInTree('node_modules/civ-engine/dist', '.js'),
    ].sort((a, b) => a.localeCompare(b));
    expect(result.source.files.map((entry) => entry.path)).toEqual(expectedPaths);
    expect(expectedPaths).not.toContain('src/worker/sim.worker.ts');

    const files = result.source.files.map((entry) => {
      const bytes = readFileSync(entry.path);
      const actual = sourceFileRecord(entry.path, bytes);
      // Name the file in the failure: a bare "expected 8614 to be 10074"
      // across the whole pinned tree says nothing about which one drifted.
      expect(entry.bytes, `${entry.path} size drifted — re-earn with npm run benchmark:recorder`)
        .toBe(actual.bytes);
      expect(
        entry.sha256,
        `${entry.path} content drifted — re-earn with npm run benchmark:recorder`,
      ).toBe(actual.sha256);
      return actual;
    });
    expect(result.source.treeSha256).toBe(finishSourceManifest(files).treeSha256);
  });

  it('keeps checkout line-ending conversion outside the source identity', () => {
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
    const lf = sourceFileRecord('example.ts', encode('const value = 1;\nexport { value };\n'));
    const crlf = sourceFileRecord(
      'example.ts',
      encode('const value = 1;\r\nexport { value };\r\n'),
    );
    const mixed = sourceFileRecord(
      'example.ts',
      encode('const value = 1;\r\nexport { value };\n'),
    );
    const changed = sourceFileRecord(
      'example.ts',
      encode('const value = 2;\nexport { value };\n'),
    );

    expect(crlf).toEqual(lf);
    expect(mixed).toEqual(lf);
    expect(changed.sha256).not.toBe(lf.sha256);
    expect(readFileSync('.gitattributes', 'utf8').replaceAll('\r\n', '\n'))
      .toBe('* text=auto eol=lf\n');
  });

  it('derives every reported aggregate from the raw runs', () => {
    for (const label of ['recorded', 'lean'] as const) {
      const runs = result.runs.filter((run) => run.label === label);
      const aggregate = result.aggregate[label];
      expect(aggregate.runs).toBe(runs.length);
      expect(aggregate.meanWallMs).toBeCloseTo(mean(runs, (run) => run.wallMs), 12);
      expect(aggregate.meanTicksPerSecond).toBeCloseTo(
        mean(runs, (run) => run.ticksPerSecond),
        12,
      );
      expect(aggregate.meanBundleJsonBytes).toBe(
        mean(runs, (run) => run.bundleJsonBytes),
      );
    }

    const { recorded, lean } = result.aggregate;
    expect(result.aggregate.wallMsReduction).toBeCloseTo(
      recorded.meanWallMs - lean.meanWallMs,
      12,
    );
    expect(result.aggregate.wallMsReductionPct).toBeCloseTo(
      (recorded.meanWallMs - lean.meanWallMs) * 100 / recorded.meanWallMs,
      12,
    );
    expect(result.aggregate.throughputGain).toBeCloseTo(
      lean.meanTicksPerSecond / recorded.meanTicksPerSecond,
      12,
    );
    expect(resultText).not.toMatch(/[A-Z]:\\Users\\/i);
  });

  it('keeps measured city outcomes identical with and without recording', () => {
    expect(new Set(result.runs.map((run) => JSON.stringify(run.final))).size).toBe(1);
    // Re-pinned 2026-07-19 for three-person profiles and composition-shaped
    // free-time weights. The same seeded choice now has a household-specific
    // distribution, so the trajectory changes without adding an RNG draw;
    // determinism is the identical-outcomes assertion, not these exact counts.
    expect(result.runs[0]?.final).toEqual({
      tick: 3002,
      buildingCount: 548,
      vehicles: 80,
      pedestrians: 122,
      completedShoppingTrips: 413,
      populationPeople: 1611,
    });
    expect(result.runs.filter((run) => run.label === 'lean').every(
      (run) => run.bundleJsonBytes === 0,
    )).toBe(true);
    expect(result.runs.filter((run) => run.label === 'recorded').every(
      (run) => run.bundleJsonBytes > 100_000_000,
    )).toBe(true);
  });
});
