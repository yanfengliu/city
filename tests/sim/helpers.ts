import { expect } from 'vitest';
import type { CitySim } from '../../src/sim/city';
import { cellIndex, lPathCells } from '../../src/sim/grid';
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

/**
 * Land cell with at least three water cells continuing straight beyond it — a
 * minimal bridge-stub site. Returns the land cell and the unit step into the
 * water, so `(x, y) → (x + 2dx, y + 2dy)` is a 1-land + 2-water road path
 * (with one more water cell beyond for extension scenarios).
 */
export function findBridgeStub(sim: CitySim): { x: number; y: number; dx: number; dy: number } {
  const { terrain } = sim;
  const water = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < terrain.width &&
    y < terrain.height &&
    terrain.water[cellIndex(x, y)] === 1;
  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      if (terrain.water[cellIndex(x, y)] === 1) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (
          water(x + dx, y + dy) &&
          water(x + 2 * dx, y + 2 * dy) &&
          water(x + 3 * dx, y + 3 * dy)
        ) {
          return { x, y, dx, dy };
        }
      }
    }
  }
  throw new Error('no bridge stub site found');
}

/**
 * Horizontal road row that crosses a water gap (1–12 cells) with 8 land cells
 * on each side and all-land 6x2 zone blocks (rows y-2..y-1) at both ends — a
 * complete commute-across-the-bridge scenario site.
 */
export function findBridgeSite(sim: CitySim): { x0: number; x1: number; y: number } {
  const { terrain } = sim;
  const isLand = (x: number, y: number) => terrain.water[cellIndex(x, y)] === 0;
  const allLand = (x0: number, y0: number, w: number, h: number): boolean => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) if (!isLand(x, y)) return false;
    }
    return true;
  };
  const LAND = 8;
  const MAX_GAP = 12;
  for (let y = 2; y < terrain.height; y++) {
    for (let x = 0; x + 2 * LAND + 1 <= terrain.width; x++) {
      if (!allLand(x, y, LAND, 1)) continue;
      let i = x + LAND;
      let gap = 0;
      while (i < terrain.width && !isLand(i, y) && gap <= MAX_GAP) {
        gap++;
        i++;
      }
      if (gap === 0 || gap > MAX_GAP || i + LAND > terrain.width) continue;
      if (!allLand(i, y, LAND, 1)) continue;
      const x1 = i + LAND - 1;
      if (!allLand(x, y - 2, 6, 2) || !allLand(x1 - 5, y - 2, 6, 2)) continue;
      return { x0: x, x1, y };
    }
  }
  throw new Error('no bridge site found');
}

/**
 * Water-adjacent land cell whose L-path to `target` stays entirely on land
 * (so a pipe can be laid from the pump to a district in one command).
 */
export function findConnectablePumpSpot(
  sim: CitySim,
  target: { x: number; y: number },
): { x: number; y: number } {
  const { terrain } = sim;
  for (let y = 1; y < terrain.height - 1; y++) {
    for (let x = 1; x < terrain.width - 1; x++) {
      const i = y * terrain.width + x;
      if (terrain.water[i] === 1) continue;
      const adjacent =
        terrain.water[i - 1] === 1 ||
        terrain.water[i + 1] === 1 ||
        terrain.water[i - terrain.width] === 1 ||
        terrain.water[i + terrain.width] === 1;
      if (!adjacent) continue;
      const path = lPathCells({ x, y }, target);
      if (path.every((c) => terrain.water[c.y * terrain.width + c.x] === 0)) {
        return { x, y };
      }
    }
  }
  throw new Error('no connectable pump spot');
}
