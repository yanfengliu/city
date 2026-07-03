import { describe, expect, it } from 'vitest';
import { createCitySim, rebuildDerived } from '../../src/sim/city';
import {
  HIGHWAY_CELLS,
  HIGHWAY_COLUMN,
  HIGHWAY_LENGTH,
} from '../../src/sim/constants/highway';
import { cellIndex } from '../../src/sim/grid';

describe('highway outside connection', () => {
  it('is absent unless highwayEnabled (existing tests stay road-free)', () => {
    const sim = createCitySim({ seed: 7 });
    expect(sim.roadCells.size).toBe(0);
  });

  it('seeds the highway as road cells that form a graph edge', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: true });
    for (const c of HIGHWAY_CELLS) expect(sim.roadCells.has(c)).toBe(true);
    expect(sim.roadCells.size).toBe(HIGHWAY_CELLS.length);
    // A straight run of road cells is one connectable edge in the graph.
    expect(sim.roadGraph.edges.length).toBeGreaterThan(0);
  });

  it('clears water and trees under the highway (always on land)', () => {
    // Seed 7's terrain has water near the top-center — the clear must win.
    const sim = createCitySim({ seed: 7, highwayEnabled: true });
    for (const c of HIGHWAY_CELLS) {
      expect(sim.terrain.water[c]).toBe(0);
      expect(sim.terrain.trees[c]).toBe(0);
    }
  });

  it('protects highway cells from bulldozeRect', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: true });
    sim.world.submit('bulldozeRect', {
      ax: HIGHWAY_COLUMN - 1,
      ay: 0,
      bx: HIGHWAY_COLUMN + 1,
      by: HIGHWAY_LENGTH - 1,
    });
    sim.world.step();
    for (const c of HIGHWAY_CELLS) expect(sim.roadCells.has(c)).toBe(true);
  });

  it('protects highway cells from bulldozeRoad', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: true });
    sim.world.submit('bulldozeRoad', {
      ax: HIGHWAY_COLUMN,
      ay: 0,
      bx: HIGHWAY_COLUMN,
      by: HIGHWAY_LENGTH - 1,
    });
    sim.world.step();
    expect(sim.roadCells.size).toBe(HIGHWAY_CELLS.length);
  });

  it('lets a player road connect into the highway network', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: true });
    // Extend a road east from the highway's inner end cell; a normal road cell.
    const endY = HIGHWAY_LENGTH - 1;
    expect(
      sim.world.submit('placeRoad', {
        ax: HIGHWAY_COLUMN,
        ay: endY,
        bx: HIGHWAY_COLUMN + 6,
        by: endY,
      }),
    ).toBe(true);
    sim.world.step();
    // The player's far cell shares the highway's connected component.
    const highwayComp = sim.roadGraph.cellComponent.get(HIGHWAY_CELLS[0]);
    const playerComp = sim.roadGraph.cellComponent.get(cellIndex(HIGHWAY_COLUMN + 6, endY));
    expect(highwayComp).toBeDefined();
    expect(playerComp).toBe(highwayComp);
    // The player's own road remains bulldozable (only the highway is fixed).
    expect(
      sim.world.submit('bulldozeRoad', {
        ax: HIGHWAY_COLUMN + 6,
        ay: endY,
        bx: HIGHWAY_COLUMN + 6,
        by: endY,
      }),
    ).toBe(true);
    sim.world.step();
    expect(sim.roadCells.has(cellIndex(HIGHWAY_COLUMN + 6, endY))).toBe(false);
    expect(sim.roadCells.has(HIGHWAY_CELLS[0])).toBe(true);
  });

  it('survives a snapshot round-trip (rebuildDerived restores it)', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: true });
    const snapshot = sim.world.serialize();
    const restored = createCitySim({ seed: 7, highwayEnabled: true });
    restored.world.applySnapshot(JSON.parse(JSON.stringify(snapshot)));
    rebuildDerived(restored);
    expect(restored.roadCells).toEqual(sim.roadCells);
    expect(restored.roadGraph.edges.length).toBe(sim.roadGraph.edges.length);
    // The fresh sim seeds the highway, then applySnapshot loads a snapshot that
    // also has it — this must not leave duplicate roadCell entities.
    expect([...restored.world.query('roadCell')].length).toBe(HIGHWAY_CELLS.length);
  });
});
