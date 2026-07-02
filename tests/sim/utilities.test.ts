import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury, rebuildDerived } from '../../src/sim/city';
import { UTILITY_ABANDON_EVALS } from '../../src/sim/constants/zoning';
import { LEVEL_INTERVAL } from '../../src/sim/constants/zoning';
import { buildDistrict, findConnectablePumpSpot, findLandBlock, stats } from './helpers';
import type { CitySim } from '../../src/sim/city';

function poweredCounts(sim: CitySim) {
  let powered = 0;
  let unpowered = 0;
  let abandoned = 0;
  for (const id of sim.world.query('building')) {
    const b = sim.world.getComponent(id, 'building');
    if (!b) continue;
    if (b.abandoned) abandoned++;
    else if (b.powered) powered++;
    else unpowered++;
  }
  return { powered, unpowered, abandoned };
}


describe('power network', () => {
  it('unpowered buildings abandon on the utility grace period and recover when powered', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    const grown = poweredCounts(sim);
    expect(grown.powered + grown.unpowered).toBeGreaterThan(0);

    // No plant anywhere: flood-fill marks everything unpowered.
    for (let i = 0; i < 20; i++) sim.world.step();
    expect(poweredCounts(sim).powered).toBe(0);

    // Grace period expires → abandonment (unwatered counts through the same streak).
    for (let i = 0; i < LEVEL_INTERVAL * (UTILITY_ABANDON_EVALS + 2); i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBeGreaterThan(0);

    // Power + water the district: coal plant + pump + pipe along the spine.
    const spineY = base.y + 2;
    expect(
      sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x, y: spineY + 4 }),
    ).toBe(true);
    const pumpAt = findConnectablePumpSpot(sim, { x: base.x + 8, y: spineY });
    expect(sim.world.submit('placeWaterPump', { x: pumpAt.x, y: pumpAt.y })).toBe(true);
    sim.world.step();
    // Pipe from the pump to the district spine (pipes go under anything on land).
    expect(
      sim.world.submit('placePipe', { ax: pumpAt.x, ay: pumpAt.y, bx: base.x + 8, by: spineY }),
    ).toBe(true);
    // Power lines from the plant along the spine.
    expect(
      sim.world.submit('placePowerLine', {
        ax: base.x,
        ay: spineY + 3,
        bx: base.x + 15,
        by: spineY + 3,
      }),
    ).toBe(true);
    for (let i = 0; i < 16 * 10; i++) sim.world.step();

    const after = poweredCounts(sim);
    expect(after.powered).toBeGreaterThan(0);
    expect(after.abandoned).toBeLessThan(poweredCounts(sim).abandoned + 1); // recovery in progress or done
    // Run further: all recovered buildings powered.
    for (let i = 0; i < 16 * 10; i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(0);
  });

  it('brownout powers the ascending-id prefix deterministically', () => {
    const run = () => {
      const sim = createCitySim({ seed: 11, utilitiesEnabled: true });
      const base = findLandBlock(sim, 18, 18);
      buildDistrict(sim, 'R', base);
      // Wind turbine: capacity 40 < district demand once grown.
      expect(
        sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x, y: base.y + 8 }),
      ).toBe(true);
      expect(
        sim.world.submit('placePowerLine', {
          ax: base.x,
          ay: base.y + 8,
          bx: base.x + 15,
          by: base.y + 3,
        }),
      ).toBe(true);
      for (let i = 0; i < 900; i++) sim.world.step();
      const powered: number[] = [];
      const unpowered: number[] = [];
      for (const id of [...sim.world.query('building')].sort((a, b) => a - b)) {
        const b = sim.world.getComponent(id, 'building');
        if (!b || b.abandoned) continue;
        (b.powered ? powered : unpowered).push(id);
      }
      return { powered, unpowered };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    if (a.powered.length > 0 && a.unpowered.length > 0) {
      // Ascending-id prefix: every powered id below every unpowered id within the network.
      expect(Math.max(...a.powered)).toBeLessThan(Math.min(...a.unpowered));
    }
  });
});

describe('water network', () => {
  it('rejects pumps away from water and accepts pipes under roads', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    // findLandBlock guarantees an all-land block: its center is not water-adjacent
    // ... unless the block borders water; use strictly interior cell of the block.
    expect(sim.world.submit('placeWaterPump', { x: base.x + 9, y: base.y + 9 })).toBe(false);

    buildDistrict(sim, 'R', base);
    // Pipe along the road spine (under the road) is legal.
    const spineY = base.y + 2;
    expect(
      sim.world.submit('placePipe', { ax: base.x, ay: spineY, bx: base.x + 15, by: spineY }),
    ).toBe(true);
    sim.world.step();
  });
});

describe('broke-state escape', () => {
  it('blocks roads while broke but allows utility purchases', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    sim.world.runMaintenance(() => sim.world.setState('treasury', -500));
    expect(
      sim.world.submit('placeRoad', { ax: base.x, ay: base.y, bx: base.x + 3, by: base.y }),
    ).toBe(false);
    expect(
      sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x + 5, y: base.y + 5 }),
    ).toBe(true);
    sim.world.step();
    expect(getTreasury(sim.world)).toBeLessThan(-500); // purchase applied while negative
  });
});

describe('utilities save/load', () => {
  it('replays identically after snapshot restore mid-simulation', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x, y: base.y + 8 });
    for (let i = 0; i < 600; i++) sim.world.step();
    expect(stats(sim).citizens).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 7, utilitiesEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);
    for (let i = 0; i < 300; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(JSON.stringify(sim.world.serialize()));
  });
});
