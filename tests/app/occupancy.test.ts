import { describe, expect, it } from 'vitest';
import {
  collectZoneOcclusionCells,
  replaceFootprintOwner,
  type FootprintView,
} from '../../src/app/occupancy';

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
});
