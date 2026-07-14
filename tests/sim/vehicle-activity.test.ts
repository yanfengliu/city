import { describe, expect, it } from 'vitest';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { bulldozeGrowableBuildings } from '../../src/sim/demolition';
import { spawnVehicle } from '../../src/sim/traffic/trips';
import { vehicleSystem } from '../../src/sim/traffic/vehicles';
import type {
  CitizenComponent,
  VehicleComponent,
  VehicleLeg,
  ZoneType,
} from '../../src/sim/types';
import { findLandBlock } from './helpers';

interface VehicleActivityFixture {
  sim: CitySim;
  home: number;
  work: number;
  alternateWork: number;
  citizen: number;
  leg: VehicleLeg;
}

function seedBuilding(
  sim: CitySim,
  x: number,
  y: number,
  zone: ZoneType,
  residents: number,
  jobsFilled: number,
): number {
  let entity = -1;
  sim.world.runMaintenance(() => {
    entity = sim.world.createEntity();
    sim.world.setPosition(entity, { x, y });
    sim.world.addComponent(entity, 'building', {
      zone,
      level: 1,
      w: 1,
      h: 1,
      residents,
      jobsFilled,
      abandoned: false,
      upEvals: 0,
      badEvals: 0,
      badUtilityEvals: 0,
      recoverEvals: 0,
      powered: true,
      watered: true,
    });
  });
  return entity;
}

function vehicleActivityFixture(): VehicleActivityFixture {
  const sim = createCitySim({ seed: 31 });
  const base = findLandBlock(sim, 12, 5);
  expect(
    sim.world.submit('placeRoad', {
      ax: base.x,
      ay: base.y + 2,
      bx: base.x + 9,
      by: base.y + 2,
    }),
  ).toBe(true);
  sim.world.step();
  const edge = sim.roadGraph.edges.find((candidate) => candidate.length >= 9);
  if (!edge) throw new Error('vehicle activity fixture has no long road edge');

  const home = seedBuilding(sim, base.x + 1, base.y + 3, 'R', 1, 0);
  const work = seedBuilding(sim, base.x + 8, base.y + 3, 'I', 0, 1);
  const alternateWork = seedBuilding(sim, base.x + 7, base.y + 3, 'C', 0, 0);
  let citizen = -1;
  sim.world.runMaintenance(() => {
    citizen = sim.world.createEntity();
    sim.world.setPosition(citizen, { x: base.x + 1, y: base.y + 3 });
    const component: CitizenComponent = {
      home,
      work,
      phase: 'toWork',
      waitUntil: 0,
      nextActivity: 'work',
      shop: null,
      shopGen: null,
    };
    sim.world.addComponent(citizen, 'citizen', component);
  });
  return {
    sim,
    home,
    work,
    alternateWork,
    citizen,
    leg: { edge: edge.id, reverse: false },
  };
}

function vehiclesForCitizen(sim: CitySim, citizen: number): number[] {
  return [...sim.world.query('vehicle')]
    .filter((id) => sim.world.getComponent(id, 'vehicle')?.citizen === citizen)
    .sort((a, b) => a - b);
}

function edgeCountTotal(sim: CitySim): number {
  let total = 0;
  for (const count of sim.edgeCounts.values()) total += count;
  return total;
}

function spawnWorkVehicle(
  fixture: VehicleActivityFixture,
  destination: number,
): number {
  const { sim, citizen, leg } = fixture;
  sim.world.runMaintenance(() => {
    spawnVehicle(sim, sim.world, citizen, [leg], true, destination);
  });
  const vehicles = vehiclesForCitizen(sim, citizen);
  return vehicles[vehicles.length - 1];
}

function advanceVehicleToArrival(sim: CitySim, vehicle: number): void {
  sim.world.runMaintenance(() => {
    const data = sim.world.getComponent(vehicle, 'vehicle');
    if (!data) throw new Error(`missing vehicle ${vehicle}`);
    sim.world.setComponent(vehicle, 'vehicle', { ...data, t: 0.99 });
    vehicleSystem(sim)(sim.world);
  });
}

describe('work vehicle activity ownership', () => {
  it('retires the old commute before reassignment can create another vehicle', () => {
    const fixture = vehicleActivityFixture();
    const { sim, citizen, work, alternateWork, leg } = fixture;
    spawnWorkVehicle(fixture, work);
    expect(vehiclesForCitizen(sim, citizen)).toHaveLength(1);
    expect(edgeCountTotal(sim)).toBe(1);

    sim.world.runMaintenance(() => {
      bulldozeGrowableBuildings(sim, sim.world, [work]);
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.work = alternateWork;
        data.phase = 'toWork';
        data.nextActivity = 'work';
      });
      sim.world.patchComponent(alternateWork, 'building', (data) => {
        data.jobsFilled = 1;
      });
      spawnVehicle(sim, sim.world, citizen, [leg], true, alternateWork);
    });

    const vehicles = vehiclesForCitizen(sim, citizen);
    expect(vehicles).toHaveLength(1);
    expect(edgeCountTotal(sim)).toBe(1);
    const active = sim.world.getComponent(vehicles[0], 'vehicle');
    expect(active?.destination).toBe(alternateWork);
    expect(active?.destinationGen).toBe(sim.world.getEntityGeneration(alternateWork));
  });

  it('rejects an outbound arrival when the destination id has been recycled', () => {
    const fixture = vehicleActivityFixture();
    const { sim, citizen, work } = fixture;
    const vehicle = spawnWorkVehicle(fixture, work);
    const originalGeneration = sim.world.getEntityGeneration(work);
    let replacement = -1;

    sim.world.runMaintenance(() => {
      sim.world.destroyEntity(work);
      replacement = sim.world.createEntity();
      sim.world.setPosition(replacement, { x: 4, y: 4 });
      sim.world.addComponent(replacement, 'building', {
        zone: 'I',
        level: 1,
        w: 1,
        h: 1,
        residents: 0,
        jobsFilled: 1,
        abandoned: false,
        upEvals: 0,
        badEvals: 0,
        badUtilityEvals: 0,
        recoverEvals: 0,
        powered: true,
        watered: true,
      });
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.work = replacement;
        data.phase = 'toWork';
      });
    });

    expect(replacement).toBe(work);
    expect(sim.world.getEntityGeneration(replacement)).not.toBe(originalGeneration);
    advanceVehicleToArrival(sim, vehicle);

    expect(vehiclesForCitizen(sim, citizen)).toEqual([]);
    expect(edgeCountTotal(sim)).toBe(0);
    expect(sim.world.getComponent(citizen, 'citizen')).toMatchObject({
      work: replacement,
      phase: 'home',
      nextActivity: 'work',
    });
  });

  it('fails a legacy outbound vehicle without destination metadata closed', () => {
    const fixture = vehicleActivityFixture();
    const { sim, citizen, work } = fixture;
    const vehicle = spawnWorkVehicle(fixture, work);
    sim.world.runMaintenance(() => {
      const current = sim.world.getComponent(vehicle, 'vehicle');
      if (!current) throw new Error(`missing vehicle ${vehicle}`);
      const legacy: VehicleComponent & {
        destination?: number;
        destinationGen?: number;
      } = { ...current };
      delete legacy.destination;
      delete legacy.destinationGen;
      sim.world.setComponent(vehicle, 'vehicle', legacy);
    });

    advanceVehicleToArrival(sim, vehicle);

    expect(vehiclesForCitizen(sim, citizen)).toEqual([]);
    expect(edgeCountTotal(sim)).toBe(0);
    expect(sim.world.getComponent(citizen, 'citizen')).toMatchObject({
      work,
      phase: 'home',
      nextActivity: 'work',
    });
  });
});
