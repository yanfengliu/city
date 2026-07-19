import { describe, expect, it } from 'vitest';
import { refreshOccupancy } from '../../src/sim/buildings';
import { createCitySim, rebuildDerived, type CitySim } from '../../src/sim/city';
import { COVERAGE_BLOCK_SIZE } from '../../src/sim/constants/services';
import { LAND_VALUE_BLOCK_SIZE } from '../../src/sim/constants/fields';
import {
  HAPPINESS_BASE,
  HAPPINESS_INTERVAL,
  HAPPINESS_PER_RUN,
  HAPPINESS_STRANDED_MEMORY_TICKS,
} from '../../src/sim/constants/happiness';
import {
  citizenHappiness,
  computeHappiness,
  markStranded,
  type HappinessBreakdown,
  type HappinessFactorId,
} from '../../src/sim/happiness';
import type { CitizenComponent } from '../../src/sim/types';
import { citizenOf, findLandBlock, seedBuilding, seedCitizen } from './helpers';

interface HappinessTown {
  sim: CitySim;
  home: number;
  work: number;
  citizen: number;
  base: { x: number; y: number };
  streetY: number;
}

/** One street, one home, one workplace, one household — every happiness input pinned. */
function happinessTown(options: { seed?: number; workOffset?: number } = {}): HappinessTown {
  const sim = createCitySim({ seed: options.seed ?? 7, fieldsEnabled: true });
  const base = findLandBlock(sim, 24, 6);
  const streetY = base.y + 2;
  expect(
    sim.world.submit('placeRoad', { ax: base.x, ay: streetY, bx: base.x + 23, by: streetY }),
  ).toBe(true);
  sim.world.step();
  const home = seedBuilding(sim, { x: base.x + 1, y: streetY + 1, zone: 'R', residents: 1 });
  const work = seedBuilding(sim, {
    x: base.x + (options.workOffset ?? 5),
    y: streetY + 1,
    zone: 'I',
    jobsFilled: 1,
  });
  refreshOccupancy(sim);
  const citizen = seedCitizen(sim, home, work);
  return { sim, home, work, citizen, base, streetY };
}

function breakdownOf(sim: CitySim, citizen: number): HappinessBreakdown {
  const breakdown = computeHappiness(sim, citizen);
  if (!breakdown) throw new Error(`no happiness breakdown for citizen ${citizen}`);
  return breakdown;
}

function scoreOf(sim: CitySim, citizen: number): number {
  return breakdownOf(sim, citizen).score;
}

function factor(breakdown: HappinessBreakdown, id: HappinessFactorId) {
  const found = breakdown.factors.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(
      `breakdown has no "${id}" factor — it lists ${breakdown.factors
        .map((entry) => entry.id)
        .join(', ')}`,
    );
  }
  return found;
}

function patchBuilding(sim: CitySim, id: number, apply: (data: { powered: boolean; watered: boolean }) => void): void {
  sim.world.runMaintenance(() => {
    sim.world.patchComponent(id, 'building', apply);
  });
}

function setCitizen(sim: CitySim, id: number, apply: (data: CitizenComponent) => void): void {
  sim.world.runMaintenance(() => {
    sim.world.patchComponent(id, 'citizen', apply);
  });
}

describe('citizen happiness', () => {
  it('starts a fresh household at the neutral base score', () => {
    const { sim, citizen } = happinessTown();
    expect(citizenHappiness(citizenOf(sim, citizen))).toBe(HAPPINESS_BASE);
  });

  it('drops when the home loses power and says so in the breakdown', () => {
    const { sim, home, citizen } = happinessTown();
    const served = scoreOf(sim, citizen);
    expect(factor(breakdownOf(sim, citizen), 'power').delta).toBeGreaterThan(0);

    patchBuilding(sim, home, (data) => {
      data.powered = false;
    });

    const dark = breakdownOf(sim, citizen);
    expect(dark.score).toBeLessThan(served);
    expect(factor(dark, 'power').delta).toBeLessThan(0);
    expect(factor(dark, 'power').label).toMatch(/power/i);
  });

  it('drops when the home loses water and says so in the breakdown', () => {
    const { sim, home, citizen } = happinessTown();
    const served = scoreOf(sim, citizen);

    patchBuilding(sim, home, (data) => {
      data.watered = false;
    });

    const dry = breakdownOf(sim, citizen);
    expect(dry.score).toBeLessThan(served);
    expect(factor(dry, 'water').delta).toBeLessThan(0);
    expect(factor(dry, 'water').label).toMatch(/water/i);
  });

  it('rises when a real service covers the home', () => {
    const { sim, base, streetY, citizen } = happinessTown();
    const uncovered = breakdownOf(sim, citizen);
    expect(factor(uncovered, 'services').delta).toBe(0);

    expect(
      sim.world.submit('placeService', {
        service: 'fireStation',
        x: base.x + 20,
        y: streetY + 1,
      }),
    ).toBe(true);
    sim.world.step();

    const covered = breakdownOf(sim, citizen);
    expect(covered.score).toBeGreaterThan(uncovered.score);
    expect(factor(covered, 'services').delta).toBeGreaterThan(0);
    expect(factor(covered, 'services').label).toMatch(/fire station/i);
  });

  it('follows land value at the home cell', () => {
    const { sim, home, citizen } = happinessTown();
    const position = sim.world.getComponent(home, 'position');
    if (!position) throw new Error('home has no position');
    const bx = Math.floor(position.x / LAND_VALUE_BLOCK_SIZE);
    const by = Math.floor(position.y / LAND_VALUE_BLOCK_SIZE);

    sim.fields.landValue.setCell(bx, by, 90);
    const rich = breakdownOf(sim, citizen);
    sim.fields.landValue.setCell(bx, by, 4);
    const poor = breakdownOf(sim, citizen);

    expect(rich.score).toBeGreaterThan(poor.score);
    expect(factor(rich, 'landValue').delta).toBeGreaterThan(0);
    expect(factor(poor, 'landValue').delta).toBeLessThan(0);
    expect(factor(rich, 'landValue').label).toContain('90');
  });

  it('penalises unemployment and names the workplace when employed', () => {
    const { sim, citizen, work } = happinessTown();
    const workPosition = sim.world.getComponent(work, 'position');
    if (!workPosition) throw new Error('workplace has no position');
    const employed = breakdownOf(sim, citizen);
    expect(factor(employed, 'employment').delta).toBeGreaterThan(0);
    expect(factor(employed, 'employment').label).toContain(
      `(${workPosition.x}, ${workPosition.y})`,
    );

    setCitizen(sim, citizen, (data) => {
      data.work = null;
    });

    const jobless = breakdownOf(sim, citizen);
    expect(jobless.score).toBeLessThan(employed.score);
    expect(factor(jobless, 'employment').delta).toBeLessThan(0);
  });

  it('penalises a long commute more than a short one', () => {
    const near = happinessTown({ workOffset: 2 });
    const far = happinessTown({ workOffset: 22 });

    const nearFactor = factor(breakdownOf(near.sim, near.citizen), 'commute');
    const farFactor = factor(breakdownOf(far.sim, far.citizen), 'commute');

    expect(farFactor.delta).toBeLessThan(nearFactor.delta);
    expect(farFactor.delta).toBeLessThan(0);
    expect(farFactor.label).toMatch(/\d+ cells/);
  });

  it('remembers an unroutable trip for a bounded window', () => {
    const { sim, citizen } = happinessTown();
    const calm = scoreOf(sim, citizen);

    sim.world.runMaintenance(() => markStranded(sim.world, citizen));
    const stranded = breakdownOf(sim, citizen);
    expect(stranded.score).toBeLessThan(calm);
    expect(factor(stranded, 'stranded').delta).toBeLessThan(0);

    setCitizen(sim, citizen, (data) => {
      data.strandedAt = sim.world.tick - HAPPINESS_STRANDED_MEMORY_TICKS - 1;
    });
    expect(scoreOf(sim, citizen)).toBe(calm);
    expect(factor(breakdownOf(sim, citizen), 'stranded').delta).toBe(0);
  });

  it('penalises a tax rate above the neutral rate on the home zone', () => {
    const { sim, citizen } = happinessTown();
    const neutral = scoreOf(sim, citizen);
    expect(factor(breakdownOf(sim, citizen), 'taxes').delta).toBe(0);

    expect(sim.world.submit('setTaxRate', { zone: 'R', rate: 20 })).toBe(true);
    sim.world.step();

    const taxed = breakdownOf(sim, citizen);
    expect(taxed.score).toBeLessThan(neutral);
    expect(factor(taxed, 'taxes').delta).toBeLessThan(0);
    expect(factor(taxed, 'taxes').label).toContain('20');
  });

  it('stays inside 0..1 for the best and the worst household the sim can produce', () => {
    const best = happinessTown({ workOffset: 2 });
    const bestPosition = best.sim.world.getComponent(best.home, 'position');
    if (!bestPosition) throw new Error('home has no position');
    best.sim.fields.landValue.setCell(
      Math.floor(bestPosition.x / LAND_VALUE_BLOCK_SIZE),
      Math.floor(bestPosition.y / LAND_VALUE_BLOCK_SIZE),
      100,
    );
    for (const service of ['fireStation', 'police', 'clinic', 'school'] as const) {
      best.sim.fields.coverage[service].setCell(
        Math.floor(bestPosition.x / COVERAGE_BLOCK_SIZE),
        Math.floor(bestPosition.y / COVERAGE_BLOCK_SIZE),
        1,
      );
    }
    expect(best.sim.world.submit('setTaxRate', { zone: 'R', rate: 0 })).toBe(true);
    best.sim.world.step();
    const bestScore = scoreOf(best.sim, best.citizen);
    expect(bestScore).toBeLessThanOrEqual(1);
    expect(bestScore).toBeGreaterThan(0.9);

    const worst = happinessTown({ workOffset: 22 });
    patchBuilding(worst.sim, worst.home, (data) => {
      data.powered = false;
      data.watered = false;
    });
    const worstPosition = worst.sim.world.getComponent(worst.home, 'position');
    if (!worstPosition) throw new Error('home has no position');
    worst.sim.fields.landValue.setCell(
      Math.floor(worstPosition.x / LAND_VALUE_BLOCK_SIZE),
      Math.floor(worstPosition.y / LAND_VALUE_BLOCK_SIZE),
      0,
    );
    setCitizen(worst.sim, worst.citizen, (data) => {
      data.work = null;
    });
    worst.sim.world.runMaintenance(() => markStranded(worst.sim.world, worst.citizen));
    expect(worst.sim.world.submit('setTaxRate', { zone: 'R', rate: 20 })).toBe(true);
    worst.sim.world.step();
    const worstScore = scoreOf(worst.sim, worst.citizen);
    expect(worstScore).toBeGreaterThanOrEqual(0);
    expect(worstScore).toBeLessThan(0.2);
  });

  it('explains the score: base plus every listed factor equals it', () => {
    const { sim, home, citizen } = happinessTown();
    patchBuilding(sim, home, (data) => {
      data.watered = false;
    });
    const breakdown = breakdownOf(sim, citizen);
    const summed = breakdown.factors.reduce(
      (total, entry) => total + entry.delta,
      breakdown.base,
    );

    expect(breakdown.raw).toBeCloseTo(summed, 10);
    expect(breakdown.score).toBeCloseTo(Math.min(1, Math.max(0, summed)), 10);
    expect(breakdown.factors.length).toBeGreaterThan(3);
    for (const entry of breakdown.factors) {
      expect(entry.label.length, `factor ${entry.id} has no explanation`).toBeGreaterThan(0);
    }
  });

  it('stores the score on the component, rotating a bounded count of citizens per run', () => {
    const { sim, home, work, citizen } = happinessTown();
    // More households than one run's budget, so the rotation has to wrap.
    const citizens: number[] = [citizen];
    for (let n = 0; n < HAPPINESS_PER_RUN + 22; n++) citizens.push(seedCitizen(sim, home, work));
    const total = citizens.length;
    for (const id of citizens) {
      setCitizen(sim, id, (data) => {
        data.happiness = 0;
      });
    }

    const visited = (): number =>
      citizens.filter((id) => citizenHappiness(citizenOf(sim, id)) !== 0).length;

    for (let n = 0; n < HAPPINESS_INTERVAL; n++) sim.world.step();
    expect(visited()).toBe(HAPPINESS_PER_RUN);

    for (let n = 0; n < HAPPINESS_INTERVAL; n++) sim.world.step();
    expect(visited()).toBe(total);
    for (const id of citizens) {
      const score = citizenHappiness(citizenOf(sim, id));
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('loads a legacy citizen with no happiness field and reads the neutral default', () => {
    const { sim, home, work } = happinessTown({ seed: 11 });
    const legacy = seedCitizen(sim, home, work);
    sim.world.runMaintenance(() => {
      const current = sim.world.getComponent(legacy, 'citizen');
      if (!current) throw new Error('seeded citizen vanished');
      const stripped: Partial<CitizenComponent> = { ...current };
      delete stripped.happiness;
      delete stripped.strandedAt;
      delete stripped.nextActivity;
      sim.world.setComponent(legacy, 'citizen', stripped as CitizenComponent);
    });

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 11, fieldsEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    expect(citizenHappiness(citizenOf(restored, legacy))).toBe(HAPPINESS_BASE);
    for (let n = 0; n < HAPPINESS_INTERVAL * 2; n++) restored.world.step();
    expect(citizenHappiness(citizenOf(restored, legacy))).toBeGreaterThan(0);
  });
});
