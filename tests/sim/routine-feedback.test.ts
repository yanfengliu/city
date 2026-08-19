import { describe, expect, it } from 'vitest';
import { createCitySim, rebuildDerived, type CitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import { TICKS_PER_DAY } from '../../src/protocol/city-clock';
import { SCHOOLING_FRESH_TICKS } from '../../src/sim/constants/routine';
import { schoolingCurrent } from '../../src/sim/traffic/schools';
import { computeHappiness } from '../../src/sim/happiness';
import { createCitizenProfile } from '../../src/sim/citizen-profile';
import type { BuildingComponent, CitizenLifeStage, CitizenProfile } from '../../src/sim/types';
import { citizenOf, seedBuilding, seedCitizen } from './helpers';

function staged(base: CitizenProfile, stages: [CitizenLifeStage, CitizenLifeStage]): CitizenProfile {
  return {
    ...base,
    members: base.members.map((m, i) =>
      i === 0 ? m : { ...m, lifeStage: stages[i - 1], age: stages[i - 1] === 'child' ? 9 : 34 },
    ),
  };
}

interface Town { sim: CitySim; citizen: number; home: number; work: number; }

/** One street, a home, a workplace, and optionally a covering school. */
function town(options: { school?: boolean; stages?: [CitizenLifeStage, CitizenLifeStage]; seed?: number } = {}): Town {
  const sim = createCitySim({ seed: options.seed ?? 7 });
  const y = 60;
  for (let x = 18; x <= 46; x++) for (const row of [y, y + 1, y + 2]) {
    const cell = cellIndex(x, row);
    sim.terrain.water[cell] = 0; sim.terrain.trees[cell] = 0;
    sim.terrain.elevation[cell] = sim.terrain.seaLevel;
  }
  expect(sim.world.submit('placeRoad', { ax: 18, ay: y, bx: 46, by: y })).toBe(true);
  sim.world.step();
  const home = seedBuilding(sim, { x: 20, y: y + 1, zone: 'R', residents: 1 });
  const work = seedBuilding(sim, { x: 40, y: y + 1, zone: 'I', jobsFilled: 1 });
  // A staffed, powered, watered C building — what `validShop` requires for the
  // household's shopping run to have anywhere to go.
  seedBuilding(sim, { x: 24, y: y + 1, zone: 'C', jobsFilled: 2 });
  if (options.school !== false) {
    expect(sim.world.submit('placeService', { service: 'school', x: 30, y: y + 1 })).toBe(true);
    sim.world.step();
  }
  rebuildDerived(sim);
  const citizen = seedCitizen(sim, home, work);
  const base = createCitizenProfile(sim.seed, citizen, sim.world.getEntityGeneration(citizen), home);
  sim.world.runMaintenance(() => {
    sim.world.addComponent(citizen, 'citizenProfile', staged(base, options.stages ?? ['adult', 'child']));
  });
  return { sim, citizen, home, work };
}

const homeOf = (sim: CitySim, home: number) =>
  sim.world.getComponent(home, 'building') as BuildingComponent;

describe('routines feed back (D3)', () => {
  it('credits the home and the city counter when a child actually arrives', { timeout: 30_000 }, () => {
    const { sim, home } = town();
    let credited = false;
    for (let i = 0; i < TICKS_PER_DAY && !credited; i++) {
      sim.world.step();
      credited = typeof homeOf(sim, home).schoolingTick === 'number'
        && ((sim.world.getState('completedSchoolTrips') as number | undefined) ?? 0) > 0;
    }
    expect(credited, 'a school arrival credited both the home and the counter').toBe(true);
  });

  it('stamps a home with nobody of school age, so it can still level', { timeout: 30_000 }, () => {
    const { sim, home } = town({ stages: ['adult', 'senior'] });
    let stamped = false;
    for (let i = 0; i < TICKS_PER_DAY && !stamped; i++) {
      sim.world.step();
      stamped = typeof homeOf(sim, home).schoolingTick === 'number';
    }
    expect(stamped, 'childless home marked current by the morning scan').toBe(true);
    // ...and never counted as a school arrival, because nobody went.
    expect((sim.world.getState('completedSchoolTrips') as number | undefined) ?? 0).toBe(0);
  });

  it('treats a pre-D3 building as current, so legacy cities do not freeze at level 2', () => {
    const legacy = { schoolingTick: undefined } as unknown as BuildingComponent;
    expect(schoolingCurrent(legacy, 999_999)).toBe(true);
    const fresh = { schoolingTick: 1000 } as unknown as BuildingComponent;
    expect(schoolingCurrent(fresh, 1000 + SCHOOLING_FRESH_TICKS)).toBe(true);
    expect(schoolingCurrent(fresh, 1000 + SCHOOLING_FRESH_TICKS + 1)).toBe(false);
  });

  it('blocks level 3 when a covering school is never actually reached', () => {
    // The case a coverage overlay cannot see: the school is inside the radius,
    // so `educated` is true, but no child ever gets there. Before D3 the
    // building levelled anyway on coverage alone.
    const { sim, home } = town();
    const covered = sim.fields.coverage.school.getAt(
      sim.world.getComponent(home, 'position')!.x,
      sim.world.getComponent(home, 'position')!.y,
    );
    expect(covered, 'the overlay says this home is covered').toBeGreaterThan(0);

    // Freeze the schooling stamp far enough in the past to go stale.
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(home, 'building', (b) => {
        b.level = 2;
        b.schoolingTick = 0;
      });
    });
    const building = homeOf(sim, home);
    expect(
      schoolingCurrent(building, SCHOOLING_FRESH_TICKS + 1),
      'stale schooling must not satisfy the gate',
    ).toBe(false);
    expect(
      schoolingCurrent(building, SCHOOLING_FRESH_TICKS),
      'and must still satisfy it right up to the boundary',
    ).toBe(true);
  });

  it('records a diagnosable gap — naming the fix — when no school reaches the home', { timeout: 30_000 }, () => {
    const { sim, citizen } = town({ school: false });
    let gap: string | null | undefined;
    for (let i = 0; i < TICKS_PER_DAY && !gap; i++) {
      sim.world.step();
      gap = citizenOf(sim, citizen).routineGap;
    }
    expect(gap, 'the missing school was recorded, not silently skipped').toBe('school');
    const breakdown = computeHappiness(sim, citizen)!;
    const factor = breakdown.factors.find((f) => f.id === 'routineGap')!;
    expect(factor.delta).toBeLessThan(0);
    // The message must name the actual fix, not "check road connectivity".
    expect(factor.label).toContain('No school');
    expect(factor.label).toMatch(/place one nearby|connect the road/);
  });

  it('proves groceries by arrival, never by proximity', { timeout: 60_000 }, () => {
    const { sim, citizen } = town({ seed: 5 });
    // Before any shopping trip the factor is neutral — a household that just
    // moved in has not had the chance, and must not be punished for it.
    const before = computeHappiness(sim, citizen)!.factors.find((f) => f.id === 'groceries')!;
    expect(before.delta).toBe(0);
    expect(before.label).toContain('No shopping trip on record');

    let stocked = false;
    for (let i = 0; i < TICKS_PER_DAY * 3 && !stocked; i++) {
      sim.world.step();
      stocked = typeof citizenOf(sim, citizen).groceryTick === 'number';
    }
    expect(stocked, 'a real arrival at a staffed shop stocked the cupboard').toBe(true);
    const after = computeHappiness(sim, citizen)!.factors.find((f) => f.id === 'groceries')!;
    expect(after.delta).toBeGreaterThan(0);
    expect(after.label).toContain('cupboard is stocked');
  });
});
