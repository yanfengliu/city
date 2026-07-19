import { describe, expect, it } from 'vitest';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { citizenDetail } from '../../src/sim/citizen-detail';
import { SERVICE_FOOTPRINT } from '../../src/sim/constants/services';
import { outingVenues } from '../../src/sim/traffic/trips';
import type { TripPhase } from '../../src/sim/types';
import { FAR_PARK, NEAR_PARK, outingPick, parkTown } from './park-town';
import { agentsFor, citizenOf, stepUntil } from './helpers';

const TRANSITIONAL: TripPhase[] = ['toWork', 'toShop', 'toHome'];

describe('an evening out at the park', () => {
  it('prefers a park in reach over the shops', () => {
    const town = parkTown({ seed: 17, parkOffsets: [NEAR_PARK] });
    expect(outingPick(town, 'leisure')).toBe(town.parks[0]);
    // A shopping run is an errand, not an outing — it still takes the shops.
    expect(outingPick(town, 'shop')).toBe(town.shops[0]);
  });

  it('spreads evenings across the parks in reach and never lands on a shop', () => {
    const town = parkTown({ seed: 17, parkOffsets: [NEAR_PARK, NEAR_PARK + 6, NEAR_PARK + 10] });
    const visited = new Set<number>();
    for (let n = 0; n < 200; n++) {
      const chosen = outingPick(town, 'leisure');
      expect(town.shops).not.toContain(chosen);
      expect(town.parks).toContain(chosen);
      if (chosen !== null) visited.add(chosen);
    }
    expect(visited.size).toBeGreaterThan(1);
  });

  it('falls back to the shops when the city has no park', () => {
    const town = parkTown({ seed: 17 });
    expect(town.parks).toHaveLength(0);
    expect(town.shops).toContain(outingPick(town, 'leisure'));
  });

  it('falls back to the shops when the only park is too far to walk to', () => {
    const town = parkTown({ seed: 17, parkOffsets: [FAR_PARK] });
    expect(town.shops).toContain(outingPick(town, 'leisure'));
  });

  it('falls back to the shops when the only park is off the home road network', () => {
    const town = parkTown({ seed: 17, parkOffsets: [20] });
    const { sim, base, streetY } = town;
    // Cut the street between the shops and the park: the park keeps a road
    // access cell, just not one a walk from home can ever reach.
    expect(
      sim.world.submit('bulldozeRoad', {
        ax: base.x + 20,
        ay: streetY,
        bx: base.x + 20,
        by: streetY,
      }),
    ).toBe(true);
    sim.world.step();
    expect(outingVenues(sim).parks).toEqual(town.parks);
    expect(town.shops).toContain(outingPick(town, 'leisure'));
  });

  it('walks an evening out to the park and brings the household home', () => {
    const town = parkTown({ seed: 17, parkOffsets: [NEAR_PARK], activity: 'leisure' });
    const { sim, citizen } = town;

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toShop', 64);
    expect(citizenOf(sim, citizen).shop).toBe(town.parks[0]);
    expect(agentsFor(sim, citizen)).toHaveLength(1);

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'atShop', 2_000);
    expect(agentsFor(sim, citizen)).toHaveLength(0);
    // A park visit is an outing, not a sale.
    expect(sim.world.getState('completedShoppingTrips')).toBe(0);
    expect(sim.world.getState('pendingRetailVisits')).toBe(0);

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'home', 2_000);
    expect(citizenOf(sim, citizen).nextActivity).toBe('work');
    expect(citizenOf(sim, citizen).shop).toBeNull();
    expect(sim.world.getState('disconnectedTrips')).toBe(0);
  });

  it('names the park in the household status line, walking there and once there', () => {
    const town = parkTown({ seed: 17, parkOffsets: [NEAR_PARK], activity: 'leisure' });
    const { sim, citizen, base, streetY } = town;
    const where = `the park at (${base.x + NEAR_PARK}, ${streetY - 2})`;

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toShop', 64);
    expect(detailStatus(sim, citizen)).toBe(`Walking out for the evening to ${where}`);
    expect(citizenDetail(sim, citizen)?.destination).toBeNull();
    expect(citizenDetail(sim, citizen)?.destinationPlace).toEqual(
      expect.objectContaining({
        entity: town.parks[0],
        generation: sim.world.getEntityGeneration(town.parks[0]),
        kind: 'service',
        label: 'park',
      }),
    );
    expect(citizenDetail(sim, citizen)?.activityPlace).toEqual(
      expect.objectContaining({
        entity: town.parks[0],
        generation: sim.world.getEntityGeneration(town.parks[0]),
        x: base.x + NEAR_PARK,
        y: streetY - 2,
        w: SERVICE_FOOTPRINT,
        h: SERVICE_FOOTPRINT,
        kind: 'service',
        label: 'park',
      }),
    );

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'atShop', 2_000);
    // Arrived, so there is no `destination` to read — the venue still has to
    // be named, or the panel would read "at an unknown address".
    expect(citizenDetail(sim, citizen)?.destination).toBeNull();
    expect(citizenDetail(sim, citizen)?.destinationPlace).toBeNull();
    expect(citizenDetail(sim, citizen)?.activityPlace?.entity).toBe(town.parks[0]);
    expect(detailStatus(sim, citizen)).toContain(`Out for the evening at ${where} until tick`);

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toHome', 2_000);
    const returning = citizenDetail(sim, citizen)!;
    expect(returning.destinationPlace).toEqual(
      expect.objectContaining({
        entity: citizenOf(sim, citizen).home,
        kind: 'building',
      }),
    );
    expect(returning.activityPlace?.entity).toBe(town.parks[0]);
  });

  it('never leaves a park-goer in a travelling phase without an agent', () => {
    const { sim, citizen } = parkTown({ seed: 29, parkOffsets: [NEAR_PARK] });
    const seen = new Set<TripPhase>();

    for (let n = 0; n < 8_000; n++) {
      sim.world.step();
      const data = citizenOf(sim, citizen);
      seen.add(data.phase);
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
  });

  it('sends the household home when its park is bulldozed mid-visit', () => {
    const town = parkTown({ seed: 17, parkOffsets: [NEAR_PARK], activity: 'leisure' });
    const { sim, citizen, base, streetY } = town;
    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'atShop', 2_000);

    expect(
      sim.world.submit('bulldozeRect', {
        ax: base.x + NEAR_PARK,
        ay: streetY - 2,
        bx: base.x + NEAR_PARK + 1,
        by: streetY - 1,
      }),
    ).toBe(true);
    sim.world.step();
    expect(outingVenues(sim).parks).toHaveLength(0);

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'home', 2_000);
    expect(citizenOf(sim, citizen).nextActivity).toBe('work');
    expect(agentsFor(sim, citizen)).toHaveLength(0);
  });
});

describe('parks in a grown city', () => {
  /**
   * The hand-seeded towns above prove the leisure path works when pointed at
   * it. This proves it actually fires in a city nobody arranged: real growth,
   * real employment, real free-time draws.
   */
  it('sends households to its parks without anything being staged', { timeout: 120_000 }, () => {
    const sim = createCitySim({ seed: 3, fieldsEnabled: true });
    sim.world.runMaintenance(() => sim.world.setState('treasury', 10_000_000));
    const x0 = 8;
    const x1 = 52;
    const y0 = 8;
    const y1 = 32;
    for (let y = y0; y <= y1; y += 4) {
      expect(sim.world.submit('placeRoad', { ax: x0, ay: y, bx: x1, by: y })).toBe(true);
    }
    for (let x = x0; x <= x1; x += 12) {
      expect(sim.world.submit('placeRoad', { ax: x, ay: y0, bx: x, by: y1 })).toBe(true);
    }
    sim.world.step();
    const pattern = ['R', 'C', 'R', 'I', 'R', 'C'] as const;
    let band = 0;
    for (let y = y0; y < y1; y += 4) {
      expect(
        sim.world.submit('zone', {
          zone: pattern[band % pattern.length],
          ax: x0,
          ay: y + 1,
          bx: x1,
          by: y + 3,
        }),
      ).toBe(true);
      band++;
    }
    sim.world.step();
    // Two parks wherever the terrain allows one — the grid's lakes make any
    // fixed pair of anchors a coin flip, and which cells they land on is not
    // what this test is about.
    const placed: number[] = [];
    for (let y = y0 + 1; y < y1 && placed.length < 2; y += 4) {
      for (let x = x0 + 1; x < x1 && placed.length < 2; x += 8) {
        const before = new Set(sim.world.query('structure'));
        if (!sim.world.submit('placeService', { service: 'park', x, y })) continue;
        sim.world.step();
        placed.push(...[...sim.world.query('structure')].filter((id) => !before.has(id)));
      }
    }
    expect(placed, 'no buildable park site anywhere on the grid').toHaveLength(2);
    const parks = new Set(outingVenues(sim).parks);
    expect(parks.size).toBe(2);

    let parkOutings = 0;
    for (let n = 0; n < 3_000; n++) {
      sim.world.step();
      if (n % 25 !== 0) continue;
      for (const id of [...sim.world.query('citizen')].sort((a, b) => a - b)) {
        const shop = sim.world.getComponent(id, 'citizen')?.shop;
        if (shop !== null && shop !== undefined && parks.has(shop)) parkOutings++;
      }
    }

    expect([...sim.world.query('citizen')].length).toBeGreaterThan(0);
    // Sampled park outings run to ~2,000 here, so this threshold is a floor
    // against the feature quietly stopping — not a tuned expectation.
    expect(parkOutings, 'households almost never chose a park').toBeGreaterThan(100);
    // Commerce still works: shopping runs and shop-fallback evenings still land.
    expect(sim.world.getState('completedShoppingTrips')).toBeGreaterThan(0);
    expect(sim.world.getState('disconnectedTrips')).toBe(0);
    // The parks survived the city growing up around them.
    expect(outingVenues(sim).parks).toEqual([...parks]);
  });
});
/** The one sentence the inspect panel prints for this household right now. */
function detailStatus(sim: CitySim, citizen: number): string {
  const detail = citizenDetail(sim, citizen);
  if (!detail) throw new Error(`no citizen detail for entity ${citizen}`);
  return detail.status;
}
