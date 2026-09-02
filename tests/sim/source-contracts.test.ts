import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name).replaceAll('\\', '/');
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

function linesOf(path: string): string[] {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n').split('\n');
}

/**
 * `world.query()` hands back a single-use Generator, not an array. A generator
 * has no `.length`, so `w.query('citizen').length` is `undefined` rather than an
 * error — and `0.3 * undefined` is `NaN`, which is written straight into world
 * state and poisons the tick. Nothing about the expression looks wrong, and
 * TypeScript accepts it. The same shape breaks silently a second way: a
 * generator iterated twice yields nothing the second time, so a double pass
 * quietly sees an empty world.
 *
 * Materialize with `[...world.query(...)]` before counting or re-iterating.
 * Iterating once with `for…of` is fine and is the common case.
 */
const ARRAY_ONLY_MEMBER =
  /\.query\([^()]*\)\s*\.\s*(length|map|filter|sort|slice|reduce|find|some|every|concat|join|indexOf|includes|reverse|flat|at)\b/;

describe('sim source contracts', () => {
  it('never treats a query() generator as an array', () => {
    const files = sourceFiles('src');
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      linesOf(file).forEach((line, index) => {
        if (ARRAY_ONLY_MEMBER.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      'query() returns a Generator: .length is undefined (NaN downstream) and a second ' +
        'iteration yields nothing — spread it into an array first',
    ).toEqual([]);

    // The detector must recognise the shape it exists to reject, and must not
    // flag the materialized form that is everywhere in this codebase.
    expect(ARRAY_ONLY_MEMBER.test("const n = w.query('citizen').length;")).toBe(true);
    expect(ARRAY_ONLY_MEMBER.test("const n = [...w.query('citizen')].length;")).toBe(false);
    expect(ARRAY_ONLY_MEMBER.test("for (const id of w.query('building')) {")).toBe(false);
  });

  /**
   * Behavior that must run does not belong behind an optional parameter.
   * `refreshRoads(sim, w?)` does the graph rebuild either way, but remaps
   * in-flight vehicles onto the renumbered edges, carries the congestion
   * buckets across, and rewrites the mirror only when it is handed the world.
   * A handler that writes `refreshRoads(sim)` compiles, runs, and silently
   * skips all three; the remap has no other caller, so nothing fails until a
   * player edits a road with cars on it.
   *
   * Inside a command handler the world is always in hand, so passing it is
   * never optional there. The two one-argument calls that remain are genuinely
   * out-of-tick: `seedHighway` at construction and `rebuildDerived` after load.
   */
  it('passes the world to refreshRoads from every command handler', () => {
    const source = readFileSync('src/sim/road/commands.ts', 'utf8').replaceAll('\r\n', '\n');
    const chunks = source.split('world.registerHandler(').slice(1);
    expect(chunks.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    let sawInTickCall = false;
    for (const chunk of chunks) {
      // Handlers are registered at one indent inside their register* function,
      // so the handler body ends at its own `  });`. Splitting on the next
      // registration instead would swallow the out-of-tick helpers that follow
      // the last handler in the file.
      const body = chunk.split(/\n {2}\}\);/)[0];
      const command = /^\s*'([^']+)'/.exec(chunk)?.[1] ?? '(unknown)';
      for (const call of body.matchAll(/refreshRoads\(([^)]*)\)/g)) {
        const args = call[1].split(',').map((a) => a.trim()).filter(Boolean);
        if (args.length < 2) offenders.push(`${command}: refreshRoads(${call[1]})`);
        else sawInTickCall = true;
      }
    }
    expect(
      offenders,
      'a command handler holds the world, so refreshRoads must receive it — without it the ' +
        'in-flight vehicle remap, the edge-bucket carry-over and the congestion mirror all ' +
        'silently do not run',
    ).toEqual([]);
    // A file that stopped calling refreshRoads in handlers would pass vacuously.
    expect(sawInTickCall).toBe(true);
  });
});
