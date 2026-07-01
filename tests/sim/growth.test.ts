import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury, type CitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import { PEOPLE_PER_CITIZEN } from '../../src/sim/constants/zoning';
import type { DemandState, ZoneType } from '../../src/sim/types';

/**
 * Finds an all-land square region of the given size and returns its top-left,
 * so tests can lay out roads and zones deterministically.
 */
function findLandBlock(sim: CitySim, w: number, h: number): { x: number; y: number } {
  const { terrain } = sim;
  for (let y = 0; y + h <= terrain.height; y++) {
    for (let x = 0; x + w <= terrain.width; x++) {
      let clear = true;
      outer: for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (terrain.water[cellIndex(x + dx, y + dy)] === 1) {
            clear = false;
            break outer;
          }
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error(`no ${w}x${h} land block found`);
}

/** Builds a road spine and zones both sides of it. */
function buildDistrict(sim: CitySim, zone: ZoneType, origin: { x: number; y: number }): void {
  const { world } = sim;
  const y = origin.y + 2;
  expect(
    world.submit('placeRoad', { ax: origin.x, ay: y, bx: origin.x + 15, by: y }),
  ).toBe(true);
  world.step();
  expect(
    world.submit('zone', { zone, ax: origin.x, ay: y - 2, bx: origin.x + 15, by: y - 1 }),
  ).toBe(true);
  expect(
    world.submit('zone', { zone, ax: origin.x, ay: y + 1, bx: origin.x + 15, by: y + 2 }),
  ).toBe(true);
  world.step();
}

function counts(sim: CitySim) {
  const buildings: Record<ZoneType, number> = { R: 0, C: 0, I: 0 };
  for (const id of sim.world.query('building')) {
    const b = sim.world.getComponent(id, 'building');
    if (b) buildings[b.zone]++;
  }
  const citizens = [...sim.world.query('citizen')].length;
  return { buildings, citizens };
}

describe('growth + demand + citizens (phase 2 core loop)', () => {
  it('grows R, then C/I as population and unemployment rise', () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 26);
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'C', { x: base.x, y: base.y + 8 });
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 16 });

    for (let i = 0; i < 600; i++) sim.world.step();

    const { buildings, citizens } = counts(sim);
    expect(buildings.R).toBeGreaterThan(0);
    expect(citizens).toBeGreaterThan(0);
    expect(buildings.I).toBeGreaterThan(0); // unemployment bootstraps industry
    expect(buildings.C).toBeGreaterThan(0); // population bootstraps commerce

    const population = sim.world.getState('population') as number;
    expect(population).toBe(citizens);
    expect(population * PEOPLE_PER_CITIZEN).toBeGreaterThan(0);

    // Zone tint bookkeeping stays consistent.
    expect(sim.zoneCells.size).toBeGreaterThan(0);
    for (const cell of sim.occupiedCells.keys()) {
      expect(sim.roadCells.has(cell)).toBe(false);
    }
  });

  it('does not grow without road access', () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 26);
    // Roadless zoning is rejected by the zone validator (nothing near a road).
    expect(
      sim.world.submit('zone', { zone: 'R', ax: base.x, ay: base.y, bx: base.x + 5, by: base.y + 5 }),
    ).toBe(false);
  });

  it('is deterministic across identical command sequences', () => {
    const run = () => {
      const sim = createCitySim({ seed: 11 });
      const base = findLandBlock(sim, 18, 26);
      buildDistrict(sim, 'R', base);
      buildDistrict(sim, 'I', { x: base.x, y: base.y + 8 });
      for (let i = 0; i < 400; i++) sim.world.step();
      return JSON.stringify(sim.world.serialize());
    };
    expect(run()).toBe(run());
  });
});

describe('abandonment via score inputs seam', () => {
  it('abandons buildings when land value collapses and recovers when it returns', () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 26);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    const before = counts(sim);
    expect(before.buildings.R).toBeGreaterThan(0);
    expect(before.citizens).toBeGreaterThan(0);

    // Collapse desirability (phase 4 will drive this from real fields) and
    // dezone the free cells so growth churn doesn't replace abandoned stock.
    sim.scoreInputs.landValueAt = () => 0;
    sim.world.submit('dezone', {
      ax: base.x,
      ay: base.y,
      bx: base.x + 17,
      by: base.y + 25,
    });
    for (let i = 0; i < 16 * 12; i++) sim.world.step();

    let abandoned = 0;
    for (const id of sim.world.query('building')) {
      const b = sim.world.getComponent(id, 'building');
      if (b?.abandoned) abandoned++;
    }
    expect(abandoned).toBe(before.buildings.R);
    expect([...sim.world.query('citizen')].length).toBe(0); // evicted

    // Restore land value → buildings recover at level 1.
    sim.scoreInputs.landValueAt = () => 30;
    for (let i = 0; i < 16 * 8; i++) sim.world.step();
    let stillAbandoned = 0;
    for (const id of sim.world.query('building')) {
      const b = sim.world.getComponent(id, 'building');
      if (b?.abandoned) stillAbandoned++;
    }
    expect(stillAbandoned).toBe(0);
  });
});

describe('bulldozeRect', () => {
  it('clears buildings and roads, refunds roads, evicts citizens', () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 26);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    expect(counts(sim).buildings.R).toBeGreaterThan(0);

    const treasuryBefore = getTreasury(sim.world);
    expect(
      sim.world.submit('bulldozeRect', {
        ax: base.x,
        ay: base.y,
        bx: base.x + 20,
        by: base.y + 8,
      }),
    ).toBe(true);
    sim.world.step();

    expect(counts(sim).buildings.R).toBe(0);
    expect(sim.occupiedCells.size).toBe(0);
    expect(sim.roadCells.size).toBe(0);
    expect([...sim.world.query('citizen')].length).toBe(0);
    expect(getTreasury(sim.world)).toBeGreaterThan(treasuryBefore); // road refund
  });
});

describe('demand state', () => {
  it('starts with positive R demand and zero-ish C/I', () => {
    const sim = createCitySim({ seed: 7 });
    for (let i = 0; i < 40; i++) sim.world.step();
    const demand = sim.world.getState('demand') as DemandState;
    expect(demand.r).toBeGreaterThan(0);
    expect(demand.c).toBeLessThanOrEqual(0);
    expect(demand.i).toBeLessThanOrEqual(0);
  });
});
