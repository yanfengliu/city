import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury, rebuildDerived, type CitySim } from '../../src/sim/city';
import { refreshOccupancy } from '../../src/sim/buildings';
import { GRID_HEIGHT, GRID_WIDTH } from '../../src/sim/constants/map';
import { SERVICE_COST } from '../../src/sim/constants/services';
import {
  POWER_INTERVAL,
  POWER_PLANT_COST,
  UTILITY_BRIDGE_RADIUS,
  WATER_PUMP_COST,
} from '../../src/sim/constants/utilities';
import { cellIndex } from '../../src/sim/grid';
import type { ZoneType } from '../../src/sim/types';
import { findLandBlock } from './helpers';

interface SeedBuildingOptions {
  x: number;
  y: number;
  w?: number;
  h?: number;
  zone: ZoneType;
  residents?: number;
  jobsFilled?: number;
}

function seedBuilding(sim: CitySim, options: SeedBuildingOptions): number {
  let entity = -1;
  sim.world.runMaintenance(() => {
    entity = sim.world.createEntity();
    sim.world.setPosition(entity, { x: options.x, y: options.y });
    sim.world.addComponent(entity, 'building', {
      zone: options.zone,
      level: 1,
      w: options.w ?? 1,
      h: options.h ?? 1,
      residents: options.residents ?? 0,
      jobsFilled: options.jobsFilled ?? 0,
      abandoned: false,
      upEvals: 0,
      badEvals: 0,
      badUtilityEvals: 0,
      recoverEvals: 0,
      powered: true,
      watered: true,
    });
  });
  refreshOccupancy(sim);
  return entity;
}

function seedCitizen(
  sim: CitySim,
  home: number,
  work: number | null,
  phase: 'home' | 'atWork' = 'home',
): number {
  let entity = -1;
  sim.world.runMaintenance(() => {
    const homePosition = sim.world.getComponent(home, 'position');
    if (!homePosition) throw new Error('seed home has no position');
    entity = sim.world.createEntity();
    sim.world.setPosition(entity, { ...homePosition });
    sim.world.addComponent(entity, 'citizen', { home, work, phase, waitUntil: 0 });
  });
  return entity;
}

function findPumpSpot(sim: CitySim): { x: number; y: number } {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const i = cellIndex(x, y);
      if (sim.terrain.water[i] === 1) continue;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (
          nx >= 0 &&
          ny >= 0 &&
          nx < GRID_WIDTH &&
          ny < GRID_HEIGHT &&
          sim.terrain.water[cellIndex(nx, ny)] === 1
        ) {
          return { x, y };
        }
      }
    }
  }
  throw new Error('no water-adjacent land cell');
}

describe('special building replacement', () => {
  it('places a service over part of a growable and demolishes the whole home', () => {
    const sim = createCitySim({ seed: 7, fieldsEnabled: true });
    const base = findLandBlock(sim, 10, 6);
    expect(
      sim.world.submit('placeRoad', {
        ax: base.x,
        ay: base.y + 2,
        bx: base.x + 7,
        by: base.y + 2,
      }),
    ).toBe(true);
    sim.world.step();

    const home = seedBuilding(sim, {
      x: base.x,
      y: base.y,
      w: 2,
      h: 2,
      zone: 'R',
      residents: 1,
    });
    const resident = seedCitizen(sim, home, null);
    const before = getTreasury(sim.world);

    // The service clips only the home's right column; the entire 2x2 home goes.
    expect(
      sim.world.submit('placeService', {
        service: 'fireStation',
        x: base.x + 1,
        y: base.y,
      }),
    ).toBe(true);
    sim.world.step();

    expect(sim.world.isAlive(home)).toBe(false);
    expect(sim.world.isAlive(resident)).toBe(false);
    expect([...sim.world.query('structure')]).toHaveLength(1);
    expect(sim.occupiedCells.has(cellIndex(base.x, base.y))).toBe(false);
    expect(sim.occupiedCells.has(cellIndex(base.x, base.y + 1))).toBe(false);
    const rubble = sim.world.getState('regrowthBlock') as Record<string, number>;
    expect(rubble[String(cellIndex(base.x, base.y))]).toBeGreaterThan(sim.world.tick);
    expect(rubble[String(cellIndex(base.x + 1, base.y + 1))]).toBeGreaterThan(sim.world.tick);
    expect(getTreasury(sim.world)).toBe(before - SERVICE_COST.fireStation);
  });

  it('lets a coal plant replace multiple growables and unassigns their workers', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 12, 6);
    const workplace = seedBuilding(sim, {
      x: base.x,
      y: base.y,
      zone: 'C',
      jobsFilled: 1,
    });
    const industry = seedBuilding(sim, { x: base.x + 1, y: base.y, zone: 'I' });
    const growableHome = seedBuilding(sim, { x: base.x + 2, y: base.y, zone: 'R' });
    const outsideHome = seedBuilding(sim, { x: base.x + 5, y: base.y, zone: 'R', residents: 1 });
    const worker = seedCitizen(sim, outsideHome, workplace, 'atWork');
    expect(
      sim.world.submit('placePowerLine', {
        ax: base.x,
        ay: base.y,
        bx: base.x + 2,
        by: base.y,
      }),
    ).toBe(true);
    expect(
      sim.world.submit('placePipe', {
        ax: base.x,
        ay: base.y,
        bx: base.x + 2,
        by: base.y,
      }),
    ).toBe(true);
    sim.world.step();
    const before = getTreasury(sim.world);

    expect(
      sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x, y: base.y }),
    ).toBe(true);
    sim.world.step();

    expect(sim.world.isAlive(workplace)).toBe(false);
    expect(sim.world.isAlive(industry)).toBe(false);
    expect(sim.world.isAlive(growableHome)).toBe(false);
    expect(sim.world.isAlive(outsideHome)).toBe(true);
    expect(sim.world.getComponent(worker, 'citizen')).toMatchObject({ work: null, phase: 'home' });
    expect([...sim.world.query('powerPlant')]).toHaveLength(1);
    expect(sim.powerLineCells.has(cellIndex(base.x, base.y))).toBe(true);
    expect(sim.pipeCells.has(cellIndex(base.x, base.y))).toBe(true);
    expect(getTreasury(sim.world)).toBe(before - POWER_PLANT_COST.coal);

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 7, utilitiesEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);
    expect([...restored.occupiedCells.entries()].sort()).toEqual(
      [...sim.occupiedCells.entries()].sort(),
    );
    expect([...restored.powerLineCells.keys()].sort()).toEqual([...sim.powerLineCells.keys()].sort());
    expect([...restored.pipeCells.keys()].sort()).toEqual([...sim.pipeCells.keys()].sort());
  });

  it('lets a water pump replace a growable on water-adjacent land', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const spot = findPumpSpot(sim);
    const building = seedBuilding(sim, { ...spot, zone: 'I' });
    expect(
      sim.world.submit('placePipe', { ax: spot.x, ay: spot.y, bx: spot.x, by: spot.y }),
    ).toBe(true);
    sim.world.step();
    const before = getTreasury(sim.world);

    expect(sim.world.submit('placeWaterPump', spot)).toBe(true);
    sim.world.step();

    expect(sim.world.isAlive(building)).toBe(false);
    expect([...sim.world.query('waterPump')]).toHaveLength(1);
    expect(sim.occupiedCells.get(cellIndex(spot.x, spot.y))).toBeDefined();
    expect(sim.pipeCells.has(cellIndex(spot.x, spot.y))).toBe(true);
    expect(getTreasury(sim.world)).toBe(before - WATER_PUMP_COST);
  });

  it('rejects a mixed footprint atomically when another special building blocks it', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 10, 6);
    const building = seedBuilding(sim, { x: base.x, y: base.y, zone: 'R' });
    expect(
      sim.world.submit('placePowerPlant', {
        kind: 'wind',
        x: base.x + 2,
        y: base.y + 2,
      }),
    ).toBe(true);
    sim.world.step();
    const wind = [...sim.world.query('powerPlant')][0];
    const before = getTreasury(sim.world);

    expect(
      sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x, y: base.y }),
    ).toBe(false);

    expect(sim.world.isAlive(building)).toBe(true);
    expect(sim.world.isAlive(wind)).toBe(true);
    expect(getTreasury(sim.world)).toBe(before);
  });

  it('rechecks occupancy at execution so competing same-tick stamps cannot overlap', () => {
    const sim = createCitySim({ seed: 7, fieldsEnabled: true, utilitiesEnabled: true });
    const base = findLandBlock(sim, 10, 6);
    expect(
      sim.world.submit('placeRoad', {
        ax: base.x,
        ay: base.y + 2,
        bx: base.x + 7,
        by: base.y + 2,
      }),
    ).toBe(true);
    sim.world.step();
    const building = seedBuilding(sim, {
      x: base.x,
      y: base.y,
      w: 2,
      h: 2,
      zone: 'R',
    });
    const before = getTreasury(sim.world);

    // Both validate against the growable. The first execution wins; the second
    // must see the new special structure and no-op without charging.
    expect(
      sim.world.submit('placeService', {
        service: 'fireStation',
        x: base.x,
        y: base.y,
      }),
    ).toBe(true);
    expect(
      sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x, y: base.y }),
    ).toBe(true);
    sim.world.step();

    expect(sim.world.isAlive(building)).toBe(false);
    expect([...sim.world.query('structure')]).toHaveLength(1);
    expect([...sim.world.query('powerPlant')]).toHaveLength(0);
    expect(getTreasury(sim.world)).toBe(before - SERVICE_COST.fireStation);
  });

  it('connects at the wider radius five but not beyond it', () => {
    const poweredAt = (distance: number): boolean => {
      const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
      const base = findLandBlock(sim, 16, 4);
      const building = seedBuilding(sim, {
        x: base.x + distance,
        y: base.y,
        zone: 'R',
      });
      expect(
        sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x, y: base.y }),
      ).toBe(true);
      for (let i = 0; i <= POWER_INTERVAL; i++) sim.world.step();
      return sim.world.getComponent(building, 'building')?.powered ?? false;
    };

    expect(UTILITY_BRIDGE_RADIUS).toBe(5);
    expect(poweredAt(5)).toBe(true);
    expect(poweredAt(6)).toBe(false);
  });
});
