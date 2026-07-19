import { describe, expect, it } from 'vitest';
import { refreshOccupancy } from '../../src/sim/buildings';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { citizenDetail, citizenDetailProblem } from '../../src/sim/citizen-detail';
import { cellIndex } from '../../src/sim/grid';
import { citizenHappiness } from '../../src/sim/happiness';
import type { VehicleComponent } from '../../src/sim/types';
import { citizenOf, findLandBlock, seedBuilding, seedCitizen, stepUntil } from './helpers';

interface DetailTown {
  sim: CitySim;
  home: number;
  work: number;
  shop: number;
  citizen: number;
  streetY: number;
}

function detailTown(options: { seed?: number } = {}): DetailTown {
  const sim = createCitySim({ seed: options.seed ?? 7 });
  const base = findLandBlock(sim, 20, 6);
  const streetY = base.y + 2;
  expect(
    sim.world.submit('placeRoad', { ax: base.x, ay: streetY, bx: base.x + 19, by: streetY }),
  ).toBe(true);
  sim.world.step();
  const home = seedBuilding(sim, { x: base.x + 1, y: streetY + 1, zone: 'R', residents: 1 });
  const work = seedBuilding(sim, { x: base.x + 8, y: streetY + 1, zone: 'I', jobsFilled: 1 });
  const shop = seedBuilding(sim, { x: base.x + 14, y: streetY + 1, zone: 'C', jobsFilled: 1 });
  refreshOccupancy(sim);
  const citizen = seedCitizen(sim, home, work);
  return { sim, home, work, shop, citizen, streetY };
}

describe('citizen detail query', () => {
  it('reports where a household lives, works, and how happy it is', () => {
    const { sim, home, work, citizen, streetY } = detailTown();
    const detail = citizenDetail(sim, citizen);
    if (!detail) throw new Error('no detail for a live citizen');

    expect(detail.entity).toBe(citizen);
    expect(detail.generation).toBe(sim.world.getEntityGeneration(citizen));
    expect(detail.home).toEqual(
      expect.objectContaining({
        entity: home,
        generation: sim.world.getEntityGeneration(home),
        y: streetY + 1,
        cell: cellIndex(
          sim.world.getComponent(home, 'position')!.x,
          sim.world.getComponent(home, 'position')!.y,
        ),
        zone: 'R',
        abandoned: false,
      }),
    );
    expect(detail.work).toEqual(expect.objectContaining({ entity: work, zone: 'I' }));
    expect(detail.work?.generation).toBe(sim.world.getEntityGeneration(work));
    expect(detail.happiness).toBe(citizenHappiness(citizenOf(sim, citizen)));
    expect(detail.phase).toBe('home');
    expect(detail.activity).toBe('work');
    expect(detail.commuteCells).toBeGreaterThan(0);
    expect(detail.status.length).toBeGreaterThan(0);
  });

  it('explains the reported happiness factor by factor', () => {
    const { sim, citizen } = detailTown();
    const detail = citizenDetail(sim, citizen);
    if (!detail) throw new Error('no detail for a live citizen');

    const summed = detail.breakdown.factors.reduce(
      (total, entry) => total + entry.delta,
      detail.breakdown.base,
    );
    expect(detail.breakdown.raw).toBeCloseTo(summed, 10);
    expect(detail.breakdown.score).toBeGreaterThanOrEqual(0);
    expect(detail.breakdown.score).toBeLessThanOrEqual(1);
    expect(detail.breakdown.factors.some((entry) => entry.delta > 0)).toBe(true);
    for (const entry of detail.breakdown.factors) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('tracks where the household is going while a trip is in flight', () => {
    const { sim, work, citizen } = detailTown();
    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toWork', 64);

    const detail = citizenDetail(sim, citizen);
    if (!detail) throw new Error('no detail for a travelling citizen');
    expect(detail.phase).toBe('toWork');
    expect(detail.destination?.entity).toBe(work);
    expect(detail.destinationPlace).toEqual(
      expect.objectContaining({
        entity: work,
        generation: sim.world.getEntityGeneration(work),
        kind: 'building',
      }),
    );
    expect(detail.agent?.kind).toBe('pedestrian');
    expect(detail.status).toContain(`(${detail.destination!.x}, ${detail.destination!.y})`);

    const walker = detail.agent!.entity;
    const walkerPosition = sim.world.getComponent(walker, 'position');
    expect(detail.cell).toBe(cellIndex(walkerPosition!.x, walkerPosition!.y));
  });

  it('reports no destination while the household is at home', () => {
    const { sim, citizen } = detailTown();
    const detail = citizenDetail(sim, citizen);
    expect(detail?.destination).toBeNull();
    expect(detail?.destinationPlace).toBeNull();
    expect(detail?.agent).toBeNull();
  });

  it('uses the logical phase target for a legacy vehicle without destination generation', () => {
    const { sim, citizen, home } = detailTown();
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.phase = 'toHome';
      });
      const vehicle = sim.world.createEntity();
      const position = sim.world.getComponent(citizen, 'position')!;
      sim.world.setPosition(vehicle, { ...position });
      sim.world.addComponent(vehicle, 'vehicle', {
        citizen,
        citizenGen: sim.world.getEntityGeneration(citizen),
        destination: home,
        legs: [],
        legIndex: 0,
        t: 0,
        toWork: false,
      } as unknown as VehicleComponent);
    });

    const detail = citizenDetail(sim, citizen)!;
    expect(detail.status).toContain('Driving home');
    expect(detail.destinationPlace).toEqual(
      expect.objectContaining({ entity: home, kind: 'building' }),
    );
  });

  it('ignores an agent whose owner generation does not match the household', () => {
    const { sim, citizen, work } = detailTown();
    sim.world.runMaintenance(() => {
      const walker = sim.world.createEntity();
      const position = sim.world.getComponent(citizen, 'position')!;
      sim.world.setPosition(walker, { ...position });
      sim.world.addComponent(walker, 'pedestrianPath', {
        citizen,
        citizenGen: sim.world.getEntityGeneration(citizen) + 1,
        memberId: 0,
        cells: [cellIndex(position.x, position.y)],
        destination: work,
        destinationGen: sim.world.getEntityGeneration(work),
        purpose: 'industrial-work',
        outbound: true,
      });
      sim.world.addComponent(walker, 'pedestrian', { segmentIndex: 0, t: 0 });
      const vehicle = sim.world.createEntity();
      sim.world.setPosition(vehicle, { ...position });
      sim.world.addComponent(vehicle, 'vehicle', {
        citizen,
        citizenGen: sim.world.getEntityGeneration(citizen) + 1,
        destination: work,
        destinationGen: sim.world.getEntityGeneration(work),
        legs: [],
        legIndex: 0,
        t: 0,
        toWork: true,
      });
    });

    expect(citizenDetail(sim, citizen)?.agent).toBeNull();
  });

  it('fails closed when an outing path and stored venue point at a recycled generation', () => {
    const { sim, citizen, shop } = detailTown();
    const shopGeneration = sim.world.getEntityGeneration(shop);
    let walker = -1;
    let replacement = -1;
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.phase = 'toShop';
        data.nextActivity = 'leisure';
        data.shop = shop;
        data.shopGen = shopGeneration;
      });
      walker = sim.world.createEntity();
      const position = sim.world.getComponent(citizen, 'position')!;
      sim.world.setPosition(walker, { ...position });
      sim.world.addComponent(walker, 'pedestrianPath', {
        citizen,
        citizenGen: sim.world.getEntityGeneration(citizen),
        memberId: 0,
        cells: [cellIndex(position.x, position.y)],
        destination: shop,
        destinationGen: shopGeneration,
        purpose: 'shopping',
        outbound: true,
      });
      sim.world.addComponent(walker, 'pedestrian', { segmentIndex: 0, t: 0 });
      sim.world.destroyEntity(shop);
      replacement = sim.world.createEntity();
      sim.world.setPosition(replacement, { x: position.x + 1, y: position.y + 1 });
      sim.world.addComponent(replacement, 'structure', { type: 'park' });
    });
    expect(replacement).toBe(shop);
    expect(sim.world.getEntityGeneration(replacement)).not.toBe(shopGeneration);

    const detail = citizenDetail(sim, citizen)!;
    expect(detail.agent?.entity).toBe(walker);
    expect(detail.destination).toBeNull();
    expect(detail.destinationPlace).toBeNull();
    expect(detail.activityPlace).toBeNull();
    expect(detail.status).toContain('an unknown address');
    expect(detail.status).not.toContain('park');
  });

  it('fails closed when a legacy outing path omits its generation but the stored venue generation is recycled', () => {
    const { sim, citizen, shop } = detailTown();
    const shopGeneration = sim.world.getEntityGeneration(shop);
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.phase = 'toShop';
        data.nextActivity = 'shop';
        data.shop = shop;
        data.shopGen = shopGeneration;
      });
      const walker = sim.world.createEntity();
      const position = sim.world.getComponent(citizen, 'position')!;
      sim.world.setPosition(walker, { ...position });
      sim.world.addComponent(walker, 'pedestrianPath', {
        citizen,
        citizenGen: sim.world.getEntityGeneration(citizen),
        memberId: 0,
        cells: [cellIndex(position.x, position.y)],
        destination: shop,
        purpose: 'shopping',
        outbound: true,
      });
      sim.world.addComponent(walker, 'pedestrian', { segmentIndex: 0, t: 0 });
      sim.world.destroyEntity(shop);
      const replacement = sim.world.createEntity();
      sim.world.setPosition(replacement, { x: position.x + 1, y: position.y + 1 });
      sim.world.addComponent(replacement, 'structure', { type: 'park' });
      expect(replacement).toBe(shop);
      expect(sim.world.getEntityGeneration(replacement)).not.toBe(shopGeneration);
    });

    const detail = citizenDetail(sim, citizen)!;
    expect(detail.destinationPlace).toBeNull();
    expect(detail.activityPlace).toBeNull();
    expect(detail.status).toContain('an unknown address');
    expect(detail.status).not.toContain('park');
  });

  it('names the entity when it is not a citizen at all', () => {
    const { sim, home } = detailTown();
    expect(citizenDetail(sim, home)).toBeNull();
    const problem = citizenDetailProblem(sim, home);
    expect(problem).toContain(String(home));
    expect(problem).toMatch(/citizen/i);

    const missing = 999_999;
    expect(citizenDetail(sim, missing)).toBeNull();
    expect(citizenDetailProblem(sim, missing)).toContain(String(missing));
  });

  it('reports an unemployed household without inventing a workplace', () => {
    const { sim, home } = detailTown();
    const jobless = seedCitizen(sim, home, null);
    const detail = citizenDetail(sim, jobless);
    if (!detail) throw new Error('no detail for an unemployed citizen');

    expect(detail.work).toBeNull();
    expect(detail.commuteCells).toBeNull();
    expect(detail.breakdown.factors.find((entry) => entry.id === 'employment')?.delta).toBeLessThan(
      0,
    );
  });
});
