import { describe, expect, it } from 'vitest';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { UTILITY_ABANDON_EVALS } from '../../src/sim/constants/zoning';
import { SERVICE_FOOTPRINT } from '../../src/sim/constants/services';
import { cellIndex } from '../../src/sim/grid';
import {
  projectBuildingView,
  projectBuildings,
  projectNetworks,
  projectRoads,
  projectStructures,
  projectZoneCells,
} from '../../src/worker/entity-projection';
import type { BuildingComponent } from '../../src/sim/types';
import { findConnectablePumpSpot, findLandBlock } from '../sim/helpers';

/**
 * Contracts for the world → protocol projections. They were extracted from
 * `sim.worker.ts`, which has no direct coverage of its own because it is a
 * module with top-level Worker side effects — so these pin the message
 * content that the renderer depends on, including the ascending-id ordering
 * that the recorded-session determinism gate replays.
 */

function building(overrides: Partial<BuildingComponent> = {}): BuildingComponent {
  return {
    zone: 'R',
    level: 1,
    w: 2,
    h: 2,
    residents: 3,
    jobsFilled: 0,
    abandoned: false,
    upEvals: 0,
    badEvals: 0,
    badUtilityEvals: 0,
    recoverEvals: 0,
    powered: true,
    watered: true,
    ...overrides,
  };
}

/** A grown district on a road, so the projections have real entities to read. */
function district(sim: CitySim): { x: number; y: number } {
  const base = findLandBlock(sim, 20, 10);
  const y = base.y + 3;
  expect(sim.world.submit('placeRoad', { ax: base.x, ay: y, bx: base.x + 14, by: y })).toBe(true);
  sim.world.step();
  expect(
    sim.world.submit('zone', { zone: 'R', ax: base.x, ay: y - 2, bx: base.x + 14, by: y - 1 }),
  ).toBe(true);
  sim.world.step();
  for (let i = 0; i < 400; i++) sim.world.step();
  return { x: base.x, y };
}

describe('projectBuildingView', () => {
  it('refuses to project a building that has no position yet', () => {
    const sim = createCitySim({ seed: 4 });
    let orphan = -1;
    sim.world.runMaintenance(() => {
      orphan = sim.world.createEntity();
      sim.world.addComponent(orphan, 'building', building());
    });
    expect(projectBuildingView(sim.world, orphan, building())).toBeNull();
  });

  it('carries the footprint, zone, level and utility flags the renderer draws', () => {
    const sim = createCitySim({ seed: 4 });
    let id = -1;
    const data = building({ zone: 'C', level: 3, residents: 0, jobsFilled: 7, powered: false });
    sim.world.runMaintenance(() => {
      id = sim.world.createEntity();
      sim.world.setPosition(id, { x: 11, y: 22 });
      sim.world.addComponent(id, 'building', data);
    });
    expect(projectBuildingView(sim.world, id, data)).toEqual({
      id,
      generation: sim.world.getEntityGeneration(id),
      x: 11,
      y: 22,
      w: 2,
      h: 2,
      kind: 'rci',
      zone: 'C',
      level: 3,
      abandoned: false,
      residents: 0,
      jobsFilled: 7,
      powered: false,
      watered: true,
      utilityDistress: 0,
    });
  });

  it('normalises utility distress against the abandon threshold, clamped at 1', () => {
    const sim = createCitySim({ seed: 4 });
    let id = -1;
    sim.world.runMaintenance(() => {
      id = sim.world.createEntity();
      sim.world.setPosition(id, { x: 3, y: 3 });
      sim.world.addComponent(id, 'building', building());
    });
    const half = building({ badUtilityEvals: Math.floor(UTILITY_ABANDON_EVALS / 2) });
    const view = projectBuildingView(sim.world, id, half);
    expect(view!.utilityDistress).toBeGreaterThan(0.4);
    expect(view!.utilityDistress).toBeLessThan(0.6);

    // Past the threshold the ratio would exceed 1; the renderer relies on 0..1.
    const over = building({ badUtilityEvals: UTILITY_ABANDON_EVALS * 3 });
    expect(projectBuildingView(sim.world, id, over)!.utilityDistress).toBe(1);
  });
});

describe('projectBuildings', () => {
  it('returns every live building in ascending entity order', () => {
    const sim = createCitySim({ seed: 4, utilitiesEnabled: true, fieldsEnabled: true });
    district(sim);
    const views = projectBuildings(sim.world);
    expect(views.length).toBeGreaterThan(0);
    const ids = views.map((v) => v.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    // Every projected building is a real, positioned entity.
    for (const view of views) {
      expect(sim.world.isAlive(view.id)).toBe(true);
      expect(sim.world.getComponent(view.id, 'position')).toBeTruthy();
    }
  });
});

describe('projectStructures', () => {
  it('projects each service at its anchor with the shared footprint', () => {
    const sim = createCitySim({ seed: 4, utilitiesEnabled: true, fieldsEnabled: true });
    const { x, y } = district(sim);
    expect(
      sim.world.submit('placeService', { service: 'fireStation', x: x + 2, y: y + 1 }),
    ).toBe(true);
    sim.world.step();

    const views = projectStructures(sim.world);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      generation: sim.world.getEntityGeneration(views[0].id),
      x: x + 2,
      y: y + 1,
      w: SERVICE_FOOTPRINT,
      h: SERVICE_FOOTPRINT,
      kind: 'service',
      service: 'fireStation',
    });
  });

  it('returns nothing for a city with no services', () => {
    const sim = createCitySim({ seed: 4 });
    expect(projectStructures(sim.world)).toEqual([]);
  });
});

describe('projectZoneCells', () => {
  it('lists every zoned cell sorted by cell index', () => {
    const sim = createCitySim({ seed: 4 });
    const { x, y } = district(sim);
    const cells = projectZoneCells(sim);
    expect(cells.length).toBeGreaterThan(0);
    const indices = cells.map((c) => c.i);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(cells.every((c) => c.zone === 'R')).toBe(true);
    expect(indices).toContain(cellIndex(x, y - 1));
  });
});

describe('projectRoads', () => {
  it('sorts the road cells and mirrors the graph edges', () => {
    const sim = createCitySim({ seed: 4 });
    const { x, y } = district(sim);
    const roads = projectRoads(sim);
    expect(roads.cells).toEqual([...roads.cells].sort((a, b) => a - b));
    expect(roads.cells).toContain(cellIndex(x, y));
    expect(roads.edges.length).toBe(sim.roadGraph.edges.length);
    for (const edge of roads.edges) {
      const source = sim.roadGraph.edges[edge.id];
      expect(edge.a).toBe(source.a);
      expect(edge.b).toBe(source.b);
      expect(edge.cells).toEqual(source.cells);
    }
  });
});

describe('projectNetworks', () => {
  it('projects plant footprints, pumps, and sorted line and pipe cells', () => {
    const sim = createCitySim({ seed: 4, utilitiesEnabled: true, fieldsEnabled: true });
    const { x, y } = district(sim);
    expect(sim.world.submit('placePowerPlant', { kind: 'coal', x, y: y + 3 })).toBe(true);
    sim.world.step();
    // Drawn RIGHT TO LEFT on purpose: the cells then enter powerLineCells in
    // descending order, so the sorted-output assertion below is real rather
    // than passing because insertion happened to be ascending anyway.
    expect(
      sim.world.submit('placePowerLine', { ax: x + 10, ay: y + 3, bx: x, by: y + 3 }),
    ).toBe(true);
    const pump = findConnectablePumpSpot(sim, { x: x + 5, y: y + 3 });
    expect(sim.world.submit('placeWaterPump', { x: pump.x, y: pump.y })).toBe(true);
    sim.world.step();
    expect(
      sim.world.submit('placePipe', { ax: pump.x, ay: pump.y, bx: x + 5, by: y + 3 }),
    ).toBe(true);
    sim.world.step();

    const networks = projectNetworks(sim, sim.world);
    expect(networks.power.plants).toHaveLength(1);
    const plant = networks.power.plants[0];
    expect(plant.kind).toBe('coal');
    expect(plant.cells).toHaveLength(plant.w * plant.h);
    // Every declared footprint cell is also in the flattened set the renderer reads.
    for (const cell of plant.cells) expect(networks.power.plantCells).toContain(cell);

    expect(networks.water.pumpCells).toContain(cellIndex(pump.x, pump.y));
    expect(networks.power.lineCells).toEqual(
      [...networks.power.lineCells].sort((a, b) => a - b),
    );
    expect(networks.water.pipeCells).toEqual(
      [...networks.water.pipeCells].sort((a, b) => a - b),
    );
    expect(networks.power.lineCells.length).toBeGreaterThan(0);
    expect(networks.water.pipeCells.length).toBeGreaterThan(0);
  });

  it('returns empty networks for a city with no utilities', () => {
    const sim = createCitySim({ seed: 4 });
    const networks = projectNetworks(sim, sim.world);
    expect(networks.power).toEqual({ plants: [], plantCells: [], lineCells: [] });
    expect(networks.water).toEqual({ pumpCells: [], pipeCells: [] });
  });
});
