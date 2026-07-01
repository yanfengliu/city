import { expect } from 'vitest';
import type { CitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import type { ZoneType } from '../../src/sim/types';

/** Finds an all-land w×h region and returns its top-left cell. */
export function findLandBlock(sim: CitySim, w: number, h: number): { x: number; y: number } {
  const { terrain } = sim;
  for (let y = 0; y + h <= terrain.height; y++) {
    for (let x = 0; x + w <= terrain.width; x++) {
      let clear = true;
      outer: for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (terrain.water[cellIndex(x + dx, y + dy)] === 1) {
            clear = false;
            break outer;
          }
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error(`no ${w}x${h} land block found`);
}

/** Horizontal road spine at origin.y+2 with zone rows on both sides. */
export function buildDistrict(
  sim: CitySim,
  zone: ZoneType,
  origin: { x: number; y: number },
  width = 15,
): void {
  const { world } = sim;
  const y = origin.y + 2;
  expect(world.submit('placeRoad', { ax: origin.x, ay: y, bx: origin.x + width, by: y })).toBe(
    true,
  );
  world.step();
  expect(
    world.submit('zone', { zone, ax: origin.x, ay: y - 2, bx: origin.x + width, by: y - 1 }),
  ).toBe(true);
  expect(
    world.submit('zone', { zone, ax: origin.x, ay: y + 1, bx: origin.x + width, by: y + 2 }),
  ).toBe(true);
  world.step();
}

export function countBuildings(sim: CitySim): Record<ZoneType, number> {
  const buildings: Record<ZoneType, number> = { R: 0, C: 0, I: 0 };
  for (const id of sim.world.query('building')) {
    const b = sim.world.getComponent(id, 'building');
    if (b && !b.abandoned) buildings[b.zone]++;
  }
  return buildings;
}

export function stats(sim: CitySim) {
  const w = sim.world;
  let employed = 0;
  for (const id of w.query('citizen')) {
    const c = w.getComponent(id, 'citizen');
    if (c && c.work !== null) employed++;
  }
  return {
    citizens: [...w.query('citizen')].length,
    vehicles: [...w.query('vehicle')].length,
    employed,
    disconnected: (w.getState('disconnectedTrips') as number) ?? 0,
  };
}
