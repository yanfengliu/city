import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury, rebuildDerived } from '../../src/sim/city';
import { GRID_HEIGHT, GRID_WIDTH } from '../../src/sim/constants/map';
import { ROAD_COST_PER_CELL, STARTING_TREASURY } from '../../src/sim/constants/economy';
import { cellIndex } from '../../src/sim/grid';

/** Finds a horizontal all-land strip of the given length for road tests. */
function findLandStrip(sim: ReturnType<typeof createCitySim>, length: number) {
  const { terrain } = sim;
  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x + length <= terrain.width; x++) {
      let clear = true;
      for (let i = 0; i < length; i++) {
        if (terrain.water[cellIndex(x + i, y)] === 1) {
          clear = false;
          break;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no land strip found');
}

function findWaterCell(sim: ReturnType<typeof createCitySim>) {
  const { terrain } = sim;
  for (let i = 0; i < terrain.water.length; i++) {
    if (terrain.water[i] === 1) return { x: i % terrain.width, y: Math.floor(i / terrain.width) };
  }
  throw new Error('no water found');
}

describe('createCitySim', () => {
  it('creates a steppable, deterministic world', () => {
    const a = createCitySim({ seed: 7 });
    const b = createCitySim({ seed: 7 });
    for (let i = 0; i < 25; i++) {
      a.world.step();
      b.world.step();
    }
    expect(a.world.tick).toBe(25);
    expect(JSON.stringify(a.world.serialize())).toBe(JSON.stringify(b.world.serialize()));
    expect(a.world.grid.width).toBe(GRID_WIDTH);
    expect(a.world.grid.height).toBe(GRID_HEIGHT);
  });

  it('starts with the configured treasury', () => {
    const sim = createCitySim({ seed: 7 });
    expect(getTreasury(sim.world)).toBe(STARTING_TREASURY);
  });
});

describe('placeRoad', () => {
  it('creates road cells, debits treasury, and rebuilds the graph', () => {
    const sim = createCitySim({ seed: 7 });
    const strip = findLandStrip(sim, 6);
    const accepted = sim.world.submit('placeRoad', {
      ax: strip.x,
      ay: strip.y,
      bx: strip.x + 5,
      by: strip.y,
    });
    expect(accepted).toBe(true);
    sim.world.step();
    expect(sim.roadCells.size).toBe(6);
    expect(getTreasury(sim.world)).toBe(STARTING_TREASURY - 6 * ROAD_COST_PER_CELL);
    expect(sim.roadGraph.edges).toHaveLength(1);
    expect(sim.topologyVersion).toBeGreaterThan(0);
  });

  it('rejects roads over water', () => {
    const sim = createCitySim({ seed: 7 });
    const water = findWaterCell(sim);
    const accepted = sim.world.submit('placeRoad', {
      ax: water.x,
      ay: water.y,
      bx: water.x,
      by: water.y,
    });
    expect(accepted).toBe(false);
  });

  it('rejects when treasury cannot cover the cost', () => {
    const sim = createCitySim({ seed: 7 });
    sim.world.runMaintenance(() => sim.world.setState('treasury', 5));
    const strip = findLandStrip(sim, 3);
    const accepted = sim.world.submit('placeRoad', {
      ax: strip.x,
      ay: strip.y,
      bx: strip.x + 2,
      by: strip.y,
    });
    expect(accepted).toBe(false);
  });

  it('only charges for new cells when overlapping existing roads', () => {
    const sim = createCitySim({ seed: 7 });
    const strip = findLandStrip(sim, 8);
    sim.world.submit('placeRoad', { ax: strip.x, ay: strip.y, bx: strip.x + 5, by: strip.y });
    sim.world.step();
    const before = getTreasury(sim.world);
    // Overlap 6 existing cells, extend by 2.
    sim.world.submit('placeRoad', { ax: strip.x, ay: strip.y, bx: strip.x + 7, by: strip.y });
    sim.world.step();
    expect(getTreasury(sim.world)).toBe(before - 2 * ROAD_COST_PER_CELL);
    expect(sim.roadCells.size).toBe(8);
  });
});

describe('bulldozeRoad', () => {
  it('removes road cells and refunds part of the cost', () => {
    const sim = createCitySim({ seed: 7 });
    const strip = findLandStrip(sim, 6);
    sim.world.submit('placeRoad', { ax: strip.x, ay: strip.y, bx: strip.x + 5, by: strip.y });
    sim.world.step();
    const before = getTreasury(sim.world);
    sim.world.submit('bulldozeRoad', { ax: strip.x, ay: strip.y, bx: strip.x + 5, by: strip.y });
    sim.world.step();
    expect(sim.roadCells.size).toBe(0);
    expect(getTreasury(sim.world)).toBe(before + Math.floor(6 * ROAD_COST_PER_CELL * 0.25));
    expect(sim.roadGraph.edges).toHaveLength(0);
  });

  it('rejects when the path has no road', () => {
    const sim = createCitySim({ seed: 7 });
    const strip = findLandStrip(sim, 3);
    expect(
      sim.world.submit('bulldozeRoad', {
        ax: strip.x,
        ay: strip.y,
        bx: strip.x + 2,
        by: strip.y,
      }),
    ).toBe(false);
  });
});

describe('rebuildDerived', () => {
  it('restores road caches from a snapshot round-trip', () => {
    const sim = createCitySim({ seed: 7 });
    const strip = findLandStrip(sim, 6);
    sim.world.submit('placeRoad', { ax: strip.x, ay: strip.y, bx: strip.x + 5, by: strip.y });
    sim.world.step();
    const snapshot = sim.world.serialize();

    const restored = createCitySim({ seed: 7 });
    restored.world.applySnapshot(JSON.parse(JSON.stringify(snapshot)));
    rebuildDerived(restored);
    expect(restored.roadCells).toEqual(sim.roadCells);
    expect(restored.roadGraph.edges).toHaveLength(1);
    expect(getTreasury(restored.world)).toBe(getTreasury(sim.world));
  });
});
