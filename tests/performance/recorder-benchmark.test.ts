// Bare specifiers on purpose: vite.config.ts aliases the node:* forms to browser shims.
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

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
  source: { treeSha256: string; files: SourceFile[] };
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
const resultText = readFileSync('benchmarks/results/2026-07-17-recorder-profile.json', 'utf8');
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
    expect(result.schemaVersion).toBe(1);
    expect(result.profileTicks).toBe(3_000);
    expect(result.runOrder).toEqual(['recorded', 'lean', 'lean', 'recorded']);
    expect(result.runs.map((run) => run.label)).toEqual(result.runOrder);
    expect(result.runs.map((run) => run.sequence)).toEqual([1, 2, 3, 4]);

    const expectedPaths = [
      'scripts/benchmark-recorder.mjs',
      'scripts/performance-scenario.mjs',
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
      // Name the file in the failure: a bare "expected 8614 to be 10074"
      // across ~100 pinned sources says nothing about which one drifted.
      expect(entry.bytes, `${entry.path} size drifted — re-earn with npm run benchmark:recorder`)
        .toBe(bytes.byteLength);
      expect(
        entry.sha256,
        `${entry.path} content drifted — re-earn with npm run benchmark:recorder`,
      ).toBe(createHash('sha256').update(bytes).digest('hex'));
      return entry;
    });
    const treeInput = files
      .map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`)
      .join('');
    expect(result.source.treeSha256).toBe(
      createHash('sha256').update(treeInput).digest('hex'),
    );
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
    // Re-pinned 2026-07-18 for citizen free-time plans. `rest` keeps a share
    // of households at home, so walkers and shopping trips fall (107 → 82,
    // 509 → 427) — the intended cost of "staying in" being a real choice. The
    // rest of the drift is the trajectory moving as activity selection changes
    // how the seeded RNG is consumed; determinism itself is pinned by the
    // identical-outcomes assertion above, not by these figures.
    expect(result.runs[0]?.final).toEqual({
      tick: 3002,
      buildingCount: 608,
      vehicles: 111,
      pedestrians: 82,
      completedShoppingTrips: 427,
      populationPeople: 1629,
    });
    expect(result.runs.filter((run) => run.label === 'lean').every(
      (run) => run.bundleJsonBytes === 0,
    )).toBe(true);
    expect(result.runs.filter((run) => run.label === 'recorded').every(
      (run) => run.bundleJsonBytes > 70_000_000,
    )).toBe(true);
  });
});
