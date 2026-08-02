// Bare specifier on purpose: vite.config.ts aliases the node:* forms to browser shims.
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { sourceFileRecord } from '../../scripts/recorder-source-manifest.mjs';

const benchmarkSource = readFileSync('scripts/benchmark-recorder.mjs', 'utf8');

describe('recorder benchmark contract', () => {
  it('keeps its controlled comparison and raw result local', () => {
    expect(benchmarkSource).toContain('const PROFILE_TICKS = 3_000');
    expect(benchmarkSource).toContain("const order = ['recorded', 'lean', 'lean', 'recorded']");
    expect(benchmarkSource).toContain('sim.world.onDiff(() => {})');
    expect(benchmarkSource).toContain('new SessionRecorder({ world: sim.world, sink: new MemorySink() })');
    expect(benchmarkSource).toContain('source: await sourceManifest()');
    expect(benchmarkSource).toContain('await vite.close()');
    expect(benchmarkSource).toContain("'output/performance/recorder-profile.json'");
    expect(benchmarkSource).toContain('await mkdir(dirname(outputPath), { recursive: true })');
    expect(benchmarkSource).toContain('await writeFile(outputPath');
    expect(benchmarkSource).not.toContain('benchmarks/results/');
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
