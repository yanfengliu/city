import { describe, expect, it } from 'vitest';
import { refreshOccupancy } from '../../src/sim/buildings';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import { findRoadCellPath } from '../../src/sim/traffic/pathing';

function prepareStreet(
  sim: CitySim,
  x0: number,
  x1: number,
  y: number,
  waterXs: readonly number[] = [],
): void {
  const water = new Set(waterXs);
  for (let x = x0; x <= x1; x++) {
    const road = cellIndex(x, y);
    const buildingRow = cellIndex(x, y + 1);
    sim.terrain.water[road] = water.has(x) ? 1 : 0;
    sim.terrain.water[buildingRow] = 0;
    sim.terrain.trees[road] = 0;
    sim.terrain.trees[buildingRow] = 0;
    sim.terrain.elevation[road] = sim.terrain.seaLevel;
    sim.terrain.elevation[buildingRow] = sim.terrain.seaLevel;
  }
  expect(sim.world.submit('placeRoad', { ax: x0, ay: y, bx: x1, by: y })).toBe(true);
  sim.world.step();
}

function seedCommute(
  sim: CitySim,
  homePosition: { x: number; y: number },
  workPosition: { x: number; y: number },
): { citizen: number; home: number; work: number } {
  let home = -1;
  let work = -1;
  let citizen = -1;
  sim.world.runMaintenance(() => {
    home = sim.world.createEntity();
    sim.world.setPosition(home, homePosition);
    sim.world.addComponent(home, 'building', {
      zone: 'R',
      level: 1,
      w: 1,
      h: 1,
      residents: 1,
      jobsFilled: 0,
      abandoned: false,
      upEvals: 0,
      badEvals: 0,
      badUtilityEvals: 0,
      recoverEvals: 0,
      powered: true,
      watered: true,
    });

    work = sim.world.createEntity();
    sim.world.setPosition(work, workPosition);
    sim.world.addComponent(work, 'building', {
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

    citizen = sim.world.createEntity();
    sim.world.setPosition(citizen, homePosition);
    sim.world.addComponent(citizen, 'citizen', {
      home,
      work,
      phase: 'home',
      waitUntil: 0,
      nextActivity: 'work',
      shop: null,
      shopGen: null,
    });
  });
  refreshOccupancy(sim);
  return { citizen, home, work };
}

function movingAgentFor(sim: CitySim, citizen: number): 'vehicle' | 'pedestrian' | null {
  for (const id of sim.world.query('vehicle')) {
    if (sim.world.getComponent(id, 'vehicle')?.citizen === citizen) return 'vehicle';
  }
  for (const id of sim.world.query('pedestrianPath')) {
    if (sim.world.getComponent(id, 'pedestrianPath')?.citizen === citizen) {
      return 'pedestrian';
    }
  }
  return null;
}

function stepUntilAgent(sim: CitySim, citizen: number): 'vehicle' | 'pedestrian' | null {
  for (let i = 0; i < 32; i++) {
    const agent = movingAgentFor(sim, citizen);
    if (agent) return agent;
    sim.world.step();
  }
  return movingAgentFor(sim, citizen);
}

describe('work commute mode selection', () => {
  it('keeps a long same-compressed-edge commute in a vehicle', () => {
    const sim = createCitySim({ seed: 7 });
    prepareStreet(sim, 10, 54, 20);
    const { citizen, home, work } = seedCommute(
      sim,
      { x: 12, y: 21 },
      { x: 50, y: 21 },
    );
    const path = findRoadCellPath(sim, home, work);

    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(24);
    expect(sim.roadGraph.cellToEdge.get(path![0])).toBe(
      sim.roadGraph.cellToEdge.get(path![path!.length - 1]),
    );
    expect(stepUntilAgent(sim, citizen)).toBe('vehicle');
  });

  it('keeps a short same-compressed-edge bridge commute in a vehicle', () => {
    const sim = createCitySim({ seed: 11 });
    prepareStreet(sim, 10, 30, 20, [19, 20, 21]);
    const { citizen, home, work } = seedCommute(
      sim,
      { x: 12, y: 21 },
      { x: 28, y: 21 },
    );
    const path = findRoadCellPath(sim, home, work);

    expect(path).not.toBeNull();
    expect(path!.length).toBeLessThanOrEqual(24);
    expect(path!.some((cell) => sim.terrain.water[cell] === 1)).toBe(true);
    expect(sim.roadGraph.cellToEdge.get(path![0])).toBe(
      sim.roadGraph.cellToEdge.get(path![path!.length - 1]),
    );
    expect(stepUntilAgent(sim, citizen)).toBe('vehicle');
  });

  it('keeps congestion-aware graph routing when the access nodes are distinct', () => {
    const sim = createCitySim({ seed: 17 });
    for (let x = 10; x <= 40; x++) {
      for (const y of [19, 20, 30]) {
        const cell = cellIndex(x, y);
        sim.terrain.water[cell] = 0;
        sim.terrain.trees[cell] = 0;
        sim.terrain.elevation[cell] = sim.terrain.seaLevel;
      }
    }
    for (let y = 20; y <= 30; y++) {
      for (const x of [10, 40]) {
        const cell = cellIndex(x, y);
        sim.terrain.water[cell] = 0;
        sim.terrain.trees[cell] = 0;
        sim.terrain.elevation[cell] = sim.terrain.seaLevel;
      }
    }
    for (const road of [
      { ax: 10, ay: 20, bx: 40, by: 20 },
      { ax: 10, ay: 30, bx: 40, by: 30 },
      { ax: 10, ay: 20, bx: 10, by: 30 },
      { ax: 40, ay: 20, bx: 40, by: 30 },
    ]) {
      expect(sim.world.submit('placeRoad', road)).toBe(true);
      sim.world.step();
    }

    const topLeft = cellIndex(10, 20);
    const topRight = cellIndex(40, 20);
    const direct = sim.roadGraph.edges.find(
      (edge) => edge.cells.includes(topLeft) && edge.cells.includes(topRight),
    );
    expect(direct).toBeDefined();
    sim.edgeBuckets.set(direct!.id, 3);
    sim.pathVersion++;
    sim.pathCache.clear();
    sim.adjacencyCache = null;

    const { citizen } = seedCommute(
      sim,
      { x: 10, y: 19 },
      { x: 40, y: 19 },
    );
    expect(stepUntilAgent(sim, citizen)).toBe('vehicle');
    const vehicleId = [...sim.world.query('vehicle')].find(
      (id) => sim.world.getComponent(id, 'vehicle')?.citizen === citizen,
    );
    expect(vehicleId).toBeDefined();
    const vehicle = sim.world.getComponent(vehicleId!, 'vehicle');
    expect(vehicle?.legs).toHaveLength(3);
    expect(vehicle?.legs.some((leg) => leg.edge === direct!.id)).toBe(false);
  });
});
