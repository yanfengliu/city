import { expect } from 'vitest';
import { refreshOccupancy } from '../../src/sim/buildings';
import { createCitySim, type CitySim } from '../../src/sim/city';
import {
  LEISURE_GARDEN_MAX_CELLS,
  LEISURE_PARK_MAX_CELLS,
} from '../../src/sim/constants/activities';
import { profileForCitizen } from '../../src/sim/citizen-profile';
import { chooseOutingDestination, outingVenues } from '../../src/sim/traffic/trips';
import type { CitizenProfile, FreeTimeActivity } from '../../src/sim/types';
import { findLandBlock, seedBuilding, seedCitizen } from './helpers';

/**
 * The shared park scenario, used by both `parks.test.ts` (the service) and
 * `park-outings.test.ts` (where an evening out goes). It lives here rather than
 * in `helpers.ts` because it is one feature's fixture, not general machinery.
 */

/** Street offset of a park close enough that an evening out should choose it. */
export const NEAR_PARK = 2;
/** Street offset putting a park's access cell past LEISURE_PARK_MAX_CELLS from home. */
export const FAR_PARK = LEISURE_PARK_MAX_CELLS + 4;
/** Street offset of a neighbourhood garden close enough for an evening stroll. */
export const NEAR_GARDEN = 8;
/** Street offset putting a garden past its deliberately shorter walking reach. */
export const FAR_GARDEN = LEISURE_GARDEN_MAX_CELLS + 4;
/** Street width holding the home, the shops, and the furthest park under test. */
export const STREET = FAR_PARK + 12;

export interface ParkTown {
  sim: CitySim;
  home: number;
  work: number;
  shops: number[];
  parks: number[];
  gardens: number[];
  citizen: number;
  base: { x: number; y: number };
  streetY: number;
}

/**
 * One straight street: a home at the west end, an industrial workplace, and
 * four staffed shops spread east along the south side, with parks placed on the
 * north side at the given offsets. Home and shops mirror `activities.test.ts`'s
 * town, so "an evening out went to a park" and "an evening out went to the
 * shops" are the same scenario differing only in what the player built.
 */
export function parkTown(
  options: {
    seed?: number;
    activity?: FreeTimeActivity;
    parkOffsets?: number[];
    gardenOffsets?: number[];
  } = {},
): ParkTown {
  const sim = createCitySim({ seed: options.seed ?? 7, fieldsEnabled: true });
  const base = findLandBlock(sim, STREET, 6);
  const streetY = base.y + 2;
  expect(
    sim.world.submit('placeRoad', { ax: base.x, ay: streetY, bx: base.x + STREET - 1, by: streetY }),
  ).toBe(true);
  sim.world.step();

  const home = seedBuilding(sim, { x: base.x + 1, y: streetY + 1, zone: 'R', residents: 1 });
  const work = seedBuilding(sim, { x: base.x + 4, y: streetY + 1, zone: 'I', jobsFilled: 1 });
  const shops = [6, 9, 12, 15].map((offset) =>
    seedBuilding(sim, { x: base.x + offset, y: streetY + 1, zone: 'C', jobsFilled: 1 }),
  );
  // refreshOccupancy keeps building footprints only, so it has to run BEFORE
  // any park is stamped — otherwise it would erase the park's own occupancy.
  refreshOccupancy(sim);

  const parks: number[] = [];
  for (const offset of options.parkOffsets ?? []) {
    const before = new Set(sim.world.query('structure'));
    expect(
      sim.world.submit('placeService', { service: 'park', x: base.x + offset, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();
    const added = [...sim.world.query('structure')].filter((id) => !before.has(id));
    expect(added, `park at offset ${offset} was not created`).toHaveLength(1);
    parks.push(added[0]);
  }
  const gardens: number[] = [];
  for (const offset of options.gardenOffsets ?? []) {
    const before = new Set(sim.world.query('structure'));
    expect(
      sim.world.submit('placeService', { service: 'garden', x: base.x + offset, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();
    const added = [...sim.world.query('structure')].filter((id) => !before.has(id));
    expect(added, `garden at offset ${offset} was not created`).toHaveLength(1);
    gardens.push(added[0]);
  }
  const citizen = seedCitizen(sim, home, work, { nextActivity: options.activity ?? 'work' });
  return { sim, home, work, shops, parks, gardens, citizen, base, streetY };
}

/** The venue an evening out would choose right now, without stepping the sim. */
export function outingPick(town: ParkTown, activity: 'shop' | 'leisure'): number | null {
  let chosen: number | null = null;
  town.sim.world.runMaintenance(() => {
    chosen = chooseOutingDestination(
      town.sim,
      town.sim.world,
      town.home,
      outingVenues(town.sim),
      activity,
      activity === 'leisure'
        ? profileForCitizen(
            town.sim,
            town.citizen,
            town.sim.world.getComponent(town.citizen, 'citizen')!,
          )
        : undefined,
    );
  });
  return chosen;
}

/** Replaces the fixture household's persistent composition for venue-choice tests. */
export function setTownProfile(town: ParkTown, profile: CitizenProfile): void {
  town.sim.world.runMaintenance(() => {
    if (town.sim.world.getComponent(town.citizen, 'citizenProfile')) {
      town.sim.world.setComponent(town.citizen, 'citizenProfile', profile);
    } else {
      town.sim.world.addComponent(town.citizen, 'citizenProfile', profile);
    }
  });
}
