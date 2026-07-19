import { describe, expect, it } from 'vitest';
import { refreshOccupancy } from '../../src/sim/buildings';
import { createCitySim, rebuildDerived, type CitySim } from '../../src/sim/city';
import {
  FREE_TIME_ACTIVITIES,
  LEISURE_NEAREST_CHOICES,
} from '../../src/sim/constants/activities';
import { freeTimeWeights, pickFreeTimeActivity } from '../../src/sim/activities';
import { chooseOutingShop, shopCandidates } from '../../src/sim/traffic/trips';
import { HAPPINESS_STRANDED_MEMORY_TICKS } from '../../src/sim/constants/happiness';
import type { CitizenComponent, FreeTimeActivity, TripPhase } from '../../src/sim/types';
import {
  agentsFor,
  citizenOf,
  findLandBlock,
  seedBuilding,
  seedCitizen,
  stepUntil,
} from './helpers';

const TRANSITIONAL: TripPhase[] = ['toWork', 'toShop', 'toHome'];

interface FreeTimeTown {
  sim: CitySim;
  home: number;
  work: number;
  shops: number[];
  citizen: number;
  streetY: number;
}

/**
 * One straight street: a home at the west end, an industrial workplace, and
 * four staffed shops spread east — enough spread that "the nearest shop" and
 * "a shop chosen for the evening" are distinguishable outcomes.
 */
function freeTimeTown(options: { seed?: number; activity?: FreeTimeActivity } = {}): FreeTimeTown {
  const sim = createCitySim({ seed: options.seed ?? 7 });
  const base = findLandBlock(sim, 24, 6);
  const streetY = base.y + 2;
  expect(
    sim.world.submit('placeRoad', { ax: base.x, ay: streetY, bx: base.x + 23, by: streetY }),
  ).toBe(true);
  sim.world.step();

  const home = seedBuilding(sim, { x: base.x + 1, y: streetY + 1, zone: 'R', residents: 1 });
  const work = seedBuilding(sim, { x: base.x + 4, y: streetY + 1, zone: 'I', jobsFilled: 1 });
  const shops = [6, 9, 12, 15].map((offset) =>
    seedBuilding(sim, { x: base.x + offset, y: streetY + 1, zone: 'C', jobsFilled: 1 }),
  );
  refreshOccupancy(sim);
  const citizen = seedCitizen(sim, home, work, {
    nextActivity: options.activity ?? 'work',
  });
  return { sim, home, work, shops, citizen, streetY };
}

function setCitizen(sim: CitySim, id: number, apply: (data: CitizenComponent) => void): void {
  sim.world.runMaintenance(() => {
    sim.world.patchComponent(id, 'citizen', apply);
  });
}

/** Draws `count` free-time picks, inside runMaintenance so `random()` is legal. */
function draw(sim: CitySim, citizen: number, count: number): FreeTimeActivity[] {
  const picks: FreeTimeActivity[] = [];
  sim.world.runMaintenance(() => {
    for (let n = 0; n < count; n++) {
      picks.push(pickFreeTimeActivity(sim.world, citizenOf(sim, citizen)));
    }
  });
  return picks;
}

describe('free-time plans', () => {
  it('only ever picks a declared free-time activity', () => {
    const { sim, citizen } = freeTimeTown();
    const picks = draw(sim, citizen, 300);
    for (const pick of picks) {
      expect(FREE_TIME_ACTIVITIES, `unknown activity "${pick}"`).toContain(pick);
    }
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it('draws the same sequence twice for one seed', () => {
    const first = freeTimeTown({ seed: 29 });
    const second = freeTimeTown({ seed: 29 });
    expect(draw(first.sim, first.citizen, 200)).toEqual(
      draw(second.sim, second.citizen, 200),
    );
  });

  it('keeps an unhappy, recently stranded household home more often than a content one', () => {
    const content = freeTimeTown({ seed: 41 });
    setCitizen(content.sim, content.citizen, (data) => {
      data.happiness = 0.95;
      data.strandedAt = null;
    });
    const weary = freeTimeTown({ seed: 41 });
    setCitizen(weary.sim, weary.citizen, (data) => {
      data.happiness = 0.05;
      data.strandedAt = weary.sim.world.tick;
    });

    const contentWeights = freeTimeWeights(
      content.sim.world,
      citizenOf(content.sim, content.citizen),
    );
    const wearyWeights = freeTimeWeights(weary.sim.world, citizenOf(weary.sim, weary.citizen));
    expect(wearyWeights.rest).toBeGreaterThan(contentWeights.rest);
    expect(wearyWeights.leisure).toBeLessThan(contentWeights.leisure);

    const restShare = (sim: CitySim, citizen: number): number =>
      draw(sim, citizen, 400).filter((pick) => pick === 'rest').length;
    expect(restShare(weary.sim, weary.citizen)).toBeGreaterThan(
      restShare(content.sim, content.citizen),
    );
  });

  it('forgets a stranded trip once its memory window passes', () => {
    const { sim, citizen } = freeTimeTown({ seed: 5 });
    setCitizen(sim, citizen, (data) => {
      data.happiness = 0.5;
      data.strandedAt = sim.world.tick;
    });
    const fresh = freeTimeWeights(sim.world, citizenOf(sim, citizen)).rest;
    setCitizen(sim, citizen, (data) => {
      data.strandedAt = sim.world.tick - HAPPINESS_STRANDED_MEMORY_TICKS - 1;
    });
    expect(freeTimeWeights(sim.world, citizenOf(sim, citizen)).rest).toBeLessThan(fresh);
  });

  it('sends a shopping run to the nearest shop and an evening out to one of the nearest few', () => {
    const { sim, home, shops } = freeTimeTown({ seed: 13 });
    const candidates = shopCandidates(sim);
    expect(candidates).toHaveLength(shops.length);

    sim.world.runMaintenance(() => {
      for (let n = 0; n < 40; n++) {
        expect(chooseOutingShop(sim, sim.world, home, candidates, 'shop')).toBe(shops[0]);
      }
      const visited = new Set<number>();
      for (let n = 0; n < 200; n++) {
        const shop = chooseOutingShop(sim, sim.world, home, candidates, 'leisure');
        if (shop !== null) visited.add(shop);
      }
      expect(visited.size).toBeGreaterThan(1);
      expect(visited.size).toBeLessThanOrEqual(LEISURE_NEAREST_CHOICES);
      for (const shop of visited) expect(shops).toContain(shop);
    });
  });

  it('walks an evening out to a live shop and brings the household home', () => {
    const { sim, citizen, shops } = freeTimeTown({ seed: 17, activity: 'leisure' });

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toShop', 64);
    const chosen = citizenOf(sim, citizen).shop;
    expect(shops).toContain(chosen);
    expect(agentsFor(sim, citizen)).toHaveLength(1);

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'atShop', 2_000);
    expect(sim.world.getState('completedShoppingTrips')).toBe(1);
    expect(agentsFor(sim, citizen)).toHaveLength(0);

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'home', 2_000);
    expect(citizenOf(sim, citizen).nextActivity).toBe('work');
    expect(citizenOf(sim, citizen).shop).toBeNull();
    expect(sim.world.getState('disconnectedTrips')).toBe(0);
  });

  it('keeps a resting household at home with no agent, then sends it back to work', () => {
    const { sim, citizen } = freeTimeTown({ seed: 23, activity: 'rest' });

    stepUntil(sim, () => citizenOf(sim, citizen).nextActivity === 'work', 32);
    const resting = citizenOf(sim, citizen);
    expect(resting.phase).toBe('home');
    expect(resting.waitUntil).toBeGreaterThan(sim.world.tick);
    expect(agentsFor(sim, citizen)).toHaveLength(0);

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toWork', 1_000);
    expect(agentsFor(sim, citizen)).toHaveLength(1);
  });

  it('never leaves a household in a travelling phase without an agent', () => {
    const { sim, citizen } = freeTimeTown({ seed: 31 });
    const seen = new Set<TripPhase>();
    const activities = new Set<string>();

    for (let n = 0; n < 8_000; n++) {
      sim.world.step();
      const data = citizenOf(sim, citizen);
      seen.add(data.phase);
      activities.add(data.nextActivity ?? 'work');
      if (TRANSITIONAL.includes(data.phase)) {
        expect(
          agentsFor(sim, citizen).length,
          `phase ${data.phase} at tick ${sim.world.tick} has no agent to complete it`,
        ).toBe(1);
      }
      expect(Number.isFinite(data.waitUntil)).toBe(true);
    }

    expect(seen.has('home')).toBe(true);
    expect(seen.has('atWork')).toBe(true);
    expect(seen.has('atShop')).toBe(true);
    expect(sim.world.getState('disconnectedTrips')).toBe(0);
    expect(activities.size).toBeGreaterThan(1);
  });

  it('preserves happiness and free-time plans across save, load, and replay', () => {
    const seed = 37;
    const { sim, citizen } = freeTimeTown({ seed });
    for (let n = 0; n < 1_200; n++) sim.world.step();

    const before = citizenOf(sim, citizen);
    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    const after = citizenOf(restored, citizen);
    expect(after.happiness).toBe(before.happiness);
    expect(after.nextActivity).toBe(before.nextActivity);
    expect(after.strandedAt ?? null).toBe(before.strandedAt ?? null);
    expect(after.phase).toBe(before.phase);

    for (let n = 0; n < 1_200; n++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(
      JSON.stringify(sim.world.serialize()),
    );
  });
});
