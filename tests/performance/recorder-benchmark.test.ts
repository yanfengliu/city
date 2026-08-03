// Bare specifier on purpose: vite.config.ts aliases the node:* forms to browser shims.
import { readFileSync } from 'fs';
import { MemorySink, SessionRecorder } from 'civ-engine';
import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import {
  cityCounts,
  runPerformancePhase,
} from '../../scripts/performance-scenario.mjs';
import { sourceFileRecord } from '../../scripts/recorder-source-manifest.mjs';

const benchmarkSource = readFileSync('scripts/benchmark-recorder.mjs', 'utf8');
const gitignore = readFileSync('.gitignore', 'utf8').replaceAll('\r\n', '\n');
const CONTRACT_TICKS = 240;

function runContract(recorded: boolean) {
  const sim = createCitySim({ seed: 3, fieldsEnabled: true });
  const recorder = recorded
    ? new SessionRecorder({ world: sim.world, sink: new MemorySink() })
    : null;
  runPerformancePhase(sim, { recorder, ticks: CONTRACT_TICKS });
  return {
    final: cityCounts(sim),
    serializedWorld: JSON.stringify(sim.world.serialize()),
    recordedTicks: recorder?.tickCount ?? 0,
    bundleBytes: recorder
      ? new TextEncoder().encode(JSON.stringify(recorder.toBundle())).byteLength
      : 0,
  };
}

describe('recorder benchmark contract', () => {
  it('keeps recording observational for the benchmark city', () => {
    const recorded = runContract(true);
    const lean = runContract(false);

    expect(recorded.final).toEqual(lean.final);
    expect(recorded.serializedWorld).toBe(lean.serializedWorld);
    expect(recorded.final.tick).toBe(CONTRACT_TICKS + 2);
    expect(recorded.final.buildingCount).toBeGreaterThan(0);
    expect(recorded.final.populationPeople).toBeGreaterThan(0);
    expect(recorded.recordedTicks).toBe(CONTRACT_TICKS + 2);
    expect(recorded.bundleBytes).toBeGreaterThan(0);
    expect(lean).toMatchObject({ recordedTicks: 0, bundleBytes: 0 });
  });

  it('keeps raw benchmark output under an ignored local path', () => {
    expect(benchmarkSource).toContain("'output/performance/recorder-profile.json'");
    expect(benchmarkSource).not.toContain('benchmarks/results/');
    expect(gitignore.split('\n')).toContain('output/');
    expect(gitignore.split('\n')).toContain('benchmarks/results/');
  });

  it('keeps the production driver as a controlled A-B-B-A comparison', () => {
    expect(benchmarkSource).toContain('const PROFILE_TICKS = 3_000');
    expect(benchmarkSource).toContain("const order = ['recorded', 'lean', 'lean', 'recorded']");
    expect(benchmarkSource).toContain('new SessionRecorder({ world: sim.world, sink: new MemorySink() })');
    expect(benchmarkSource).toContain(
      'runPerformancePhase(sim, { recorder, ticks: PROFILE_TICKS })',
    );
    expect(benchmarkSource).toContain('source: await sourceManifest()');
    expect(benchmarkSource).toContain('await mkdir(dirname(outputPath), { recursive: true })');
    expect(benchmarkSource).toContain('await writeFile(outputPath');
    expect(benchmarkSource).toContain('await vite.close()');
  });

  it('keeps setup and recorder wiring outside the timed loop in both modes', () => {
    const events: string[] = [];
    const fakeSim = {
      world: {
        onDiff: () => { events.push('listener'); },
        step: () => { events.push('step'); },
      },
    };
    const recorder = {
      connect: () => { events.push('connect'); },
      disconnect: () => { events.push('disconnect'); },
    };
    const times = [10, 25];
    const wallMs = runPerformancePhase(fakeSim as never, {
      recorder: recorder as never,
      ticks: 2,
      setup: () => { events.push('setup'); },
      now: () => {
        events.push('now');
        return times.shift() ?? 0;
      },
    });

    expect(wallMs).toBe(15);
    expect(events).toEqual([
      'listener', 'connect', 'setup', 'now', 'step', 'step', 'now', 'disconnect',
    ]);

    events.length = 0;
    runPerformancePhase(fakeSim as never, {
      ticks: 1,
      setup: () => { events.push('setup'); },
      now: () => 0,
    });
    expect(events).toEqual(['listener', 'setup', 'step']);
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
});
