import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  collectZoneOcclusionCells,
  replaceFootprintOwner,
  type FootprintView,
} from '../../src/app/occupancy';

/**
 * An entity id freed by a demolition can be reused by its replacement before the
 * tick diff is even emitted, so the two sides of a render diff must agree about
 * what "this id" means. The producer projects removals per render component,
 * never from generic entity destruction — a coalesced remove+set arrives as an
 * upsert only, and treating the destroyed id as a removal erases the
 * replacement. The consumer then has the mirror obligation: an upsert for an id
 * it already knows must release that id's OLD footprint before claiming the new
 * one, or the replacement appears while an invisible occupancy stays behind.
 *
 * Fixing one side alone converts a disappearing building into stale invisible
 * occupancy. The two are a pair, so both are pinned here — including the call
 * site, because the reconciler is correct in isolation whether or not anyone
 * hands it the previous view.
 */
describe('client occupancy caches', () => {
  it('clears the old footprint when an entity id is recycled at a new location', () => {
    const owners = new Map<number, number>();
    const previous: FootprintView = { id: 7, x: 1, y: 1, w: 2, h: 2 };
    const recycled: FootprintView = { id: 7, x: 6, y: 3, w: 2, h: 2 };

    expect(replaceFootprintOwner(owners, undefined, previous, 20)).toBe(true);
    expect(replaceFootprintOwner(owners, previous, recycled, 20)).toBe(true);

    expect([...owners.keys()].sort((a, b) => a - b)).toEqual([66, 67, 86, 87]);
    expect([...owners.values()]).toEqual([7, 7, 7, 7]);
  });

  it('occludes zones under growables, services, plants, and pumps', () => {
    const occluded = collectZoneOcclusionCells(
      new Map([[11, 1]]),
      new Map([[22, 2]]),
      new Set([33, 34]),
    );

    expect([...occluded].sort((a, b) => a - b)).toEqual([11, 22, 33, 34]);
  });

  it('is handed the previous view at every call site that reconciles a footprint', () => {
    // The reconciler cannot release a footprint it was never told about, and a
    // caller that passes `undefined` compiles, type-checks, and leaves the whole
    // suite green while every recycled id strands its old cells.
    const source = readFileSync('src/app/game.ts', 'utf8').replaceAll('\r\n', '\n');
    const calls = [...source.matchAll(/replaceFootprintOwner\(([^;]*?)\)/gs)].map((match) =>
      match[1].split(',').map((argument) => argument.trim()).filter(Boolean),
    );
    expect(calls.length, 'game.ts must reconcile both the building and structure caches')
      .toBeGreaterThanOrEqual(4);

    for (const [cache, previous] of calls) {
      expect(
        previous,
        `replaceFootprintOwner(${cache}, ${previous}, …) discards the previous footprint — a ` +
          'recycled id would claim its new cells while still owning its old ones',
      ).toBe('previous');
    }
    // …and `previous` must be read out of the live cache, not invented.
    expect(source).toContain('const previous = this.buildings.get(');
    expect(source).toContain('const previous = this.structures.get(');
  });
});
