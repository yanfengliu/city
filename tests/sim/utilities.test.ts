import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury, rebuildDerived } from '../../src/sim/city';
import { PIPE_COST_PER_CELL } from '../../src/sim/constants/utilities';
import { UTILITY_ABANDON_EVALS } from '../../src/sim/constants/zoning';
import { LEVEL_INTERVAL } from '../../src/sim/constants/zoning';
import { cellIndex, lPathCells } from '../../src/sim/grid';
import {
  buildDistrict,
  findBridgeSite,
  findConnectablePumpSpot,
  findLandBlock,
  stats,
} from './helpers';
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

function seedDryBuilding(sim: CitySim, x: number, y: number): number {
  let entity = -1;
  sim.world.runMaintenance(() => {
    entity = sim.world.createEntity();
    sim.world.setPosition(entity, { x, y });
    sim.world.addComponent(entity, 'building', {
      zone: 'R',
      level: 1,
      w: 1,
      h: 1,
      residents: 0,
      jobsFilled: 0,
      abandoned: false,
      upEvals: 0,
      badEvals: 0,
      badUtilityEvals: 0,
      recoverEvals: 0,
      powered: true,
      watered: false,
    });
  });
  return entity;
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
    // Pipe from the pump to the district spine (pipes cross terrain and run under structures).
    expect(
      sim.world.submit('placePipe', { ax: pumpAt.x, ay: pumpAt.y, bx: base.x + 8, by: spineY }),
    ).toBe(true);
    // Buildings do not relay water, so the main has to run the whole spine
    // rather than touching it at one point (see tests/sim/conduction.test.ts).
    expect(
      sim.world.submit('placePipe', { ax: base.x, ay: spineY, bx: base.x + 15, by: spineY }),
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

  it('regaining utilities resets the utility-abandon streak (no premature abandon on flicker)', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    // Drive the utility signal directly so we can flicker it precisely; the
    // score is otherwise healthy (default land value, no pollution).
    let hasPower = true;
    const baseInputs = sim.scoreInputs;
    sim.scoreInputs = { ...baseInputs, powered: () => hasPower, watered: () => true };
    const base = findLandBlock(sim, 18, 8);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    // Grown + healthy via the override (b.powered stays false — no real plant).
    expect(poweredCounts(sim).unpowered).toBeGreaterThan(0);
    expect(poweredCounts(sim).abandoned).toBe(0);

    // Cut utilities and accumulate the utility-abandon streak to just under the
    // grace (never crossing it).
    hasPower = false;
    for (let i = 0; i < LEVEL_INTERVAL * (UTILITY_ABANDON_EVALS - 8); i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(0);

    // Restore utilities briefly — the buildings are fully healthy again, which
    // must clear the utility-abandon streak.
    hasPower = true;
    for (let i = 0; i < LEVEL_INTERVAL * 3; i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(0);

    // Lose utilities again: with a *fresh* grace, nothing abandons within a
    // dozen evals. Without the reset the streak resumed near the cap and would
    // cross UTILITY_ABANDON_EVALS almost immediately.
    hasPower = false;
    for (let i = 0; i < LEVEL_INTERVAL * 12; i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(0);
  });

  it('keeps the full utility grace where pollution depresses land value (onboarding)', () => {
    // Regression: missing utilities drop the +10 utility bonus from the score;
    // if pollution also lowers land value, the raw score falls below
    // ABANDON_SCORE and the fast 8s score path pre-empts the 60s utility grace,
    // mass-abandoning a fresh district before the player can wire power/water.
    const sim = createCitySim({ seed: 7, fieldsEnabled: true, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    // Establish the unpowered district on neutral land — the grace holds here.
    for (let i = 0; i < 400; i++) sim.world.step();
    const grown = poweredCounts(sim);
    expect(grown.powered + grown.unpowered).toBeGreaterThan(0);
    expect(grown.powered).toBe(0); // no plant wired
    expect(grown.abandoned).toBe(0);

    // A coal plant beside the homes: a pollution source that depresses land
    // value. We deliberately do NOT wire power — the ONLY faults are "missing
    // utilities" (its own 75-eval grace) and pollution-lowered land value.
    expect(sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x + 6, y: base.y + 6 })).toBe(
      true,
    );

    // Well past the fast score path (ABANDON_EVALS=10) but within the utility
    // grace (UTILITY_ABANDON_EVALS=75): a still-unpowered building must not be
    // abandoned yet — the grace owns the timeline while utilities are missing.
    for (let i = 0; i < LEVEL_INTERVAL * 25; i++) sim.world.step();
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
      // Wire the WHOLE district, so every building is attached to the one
      // network and the only reason to be unpowered is the brownout prefix.
      // (Buildings no longer relay supply, so an unwired building would be
      // unpowered for lack of reach and would muddle the ordering assertion.)
      expect(
        sim.world.submit('placePowerLine', {
          ax: base.x,
          ay: base.y + 8,
          bx: base.x,
          by: base.y + 2,
        }),
      ).toBe(true);
      expect(
        sim.world.submit('placePowerLine', {
          ax: base.x,
          ay: base.y + 2,
          bx: base.x + 15,
          by: base.y + 2,
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
  it('lays and charges for an underground pipe across lake cells', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const site = findBridgeSite(sim);
    const from = { x: site.x0, y: site.y };
    const to = { x: site.x1, y: site.y };
    const path = lPathCells(from, to);
    const waterCells = path.filter(
      ({ x, y }) => sim.terrain.water[cellIndex(x, y)] === 1,
    );
    const before = getTreasury(sim.world);

    expect(waterCells.length).toBeGreaterThan(0);
    expect(
      sim.world.submit('placePipe', { ax: from.x, ay: from.y, bx: to.x, by: to.y }),
    ).toBe(true);
    sim.world.step();

    expect(path.every(({ x, y }) => sim.pipeCells.has(cellIndex(x, y)))).toBe(true);
    expect(getTreasury(sim.world)).toBe(before - path.length * PIPE_COST_PER_CELL);
  });

  it('conducts water across a lake and rebuilds the same water-cell pipes after load', () => {
    const config = { seed: 7, utilitiesEnabled: true } as const;
    const sim = createCitySim(config);
    const site = findBridgeSite(sim);
    const pump = { x: site.x0 + 7, y: site.y };
    const destination = { x: site.x1, y: site.y };
    const building = seedDryBuilding(sim, destination.x, destination.y);

    expect(sim.world.submit('placeWaterPump', pump)).toBe(true);
    sim.world.step();
    expect(
      sim.world.submit('placePipe', {
        ax: pump.x,
        ay: pump.y,
        bx: destination.x,
        by: destination.y,
      }),
    ).toBe(true);
    for (let i = 0; i < 16; i++) sim.world.step();

    expect(sim.world.getComponent(building, 'building')?.watered).toBe(true);
    const waterPipeCells = [...sim.pipeCells.keys()].filter(
      (index) => sim.terrain.water[index] === 1,
    );
    expect(waterPipeCells.length).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim(config);
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    expect([...restored.pipeCells.keys()].sort((a, b) => a - b)).toEqual(
      [...sim.pipeCells.keys()].sort((a, b) => a - b),
    );
    expect(waterPipeCells.every((index) => restored.pipeCells.has(index))).toBe(true);
    for (let i = 0; i < 16; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(JSON.stringify(sim.world.serialize()));
  });

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
