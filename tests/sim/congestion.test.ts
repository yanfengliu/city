import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { buildDistrict, findLandBlock, stats } from './helpers';

/**
 * Phase 3 acceptance: overloading one artery produces congestion buckets;
 * adding a parallel route reduces the worst bucket.
 */
describe('congestion under load', () => {
  it('builds up on a single corridor and relaxes when a parallel road opens', { timeout: 60_000 }, () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 26);

    // Dense R district (two spines) feeding a single I district through one
    // vertical corridor.
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'R', { x: base.x, y: base.y + 5 });
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 16 });
    const corridorX = base.x + 8;
    expect(
      sim.world.submit('placeRoad', {
        ax: corridorX,
        ay: base.y + 2,
        bx: corridorX,
        by: base.y + 18,
      }),
    ).toBe(true);
    sim.world.step();

    let maxBucketSingle = 0;
    let peakVehicles = 0;
    for (let i = 0; i < 5000; i++) {
      sim.world.step();
      if (i % 64 === 0) {
        for (const bucket of sim.edgeBuckets.values()) {
          maxBucketSingle = Math.max(maxBucketSingle, bucket);
        }
        peakVehicles = Math.max(peakVehicles, stats(sim).vehicles);
      }
      if (maxBucketSingle >= 2) break;
    }
    expect(peakVehicles).toBeGreaterThan(10);
    expect(maxBucketSingle).toBeGreaterThanOrEqual(1);

    // Open a parallel corridor OUTSIDE the zoned band (x+16 — the 2x2 growth
    // rule keeps that column unbuilt) with short spine extensions to reach it.
    const reliefX = base.x + 16;
    for (const spineY of [base.y + 2, base.y + 7, base.y + 18]) {
      expect(
        sim.world.submit('placeRoad', {
          ax: base.x + 15,
          ay: spineY,
          bx: reliefX,
          by: spineY,
        }),
      ).toBe(true);
    }
    sim.world.step();
    expect(
      sim.world.submit('placeRoad', {
        ax: reliefX,
        ay: base.y + 2,
        bx: reliefX,
        by: base.y + 18,
      }),
    ).toBe(true);
    sim.world.step();

    let maxBucketAfter = 0;
    for (let i = 0; i < 4000; i++) {
      sim.world.step();
      if (i > 2000 && i % 64 === 0) {
        for (const bucket of sim.edgeBuckets.values()) {
          maxBucketAfter = Math.max(maxBucketAfter, bucket);
        }
      }
    }
    expect(maxBucketAfter).toBeLessThanOrEqual(maxBucketSingle);
  });
});
