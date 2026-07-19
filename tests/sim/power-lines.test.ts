import { describe, expect, it } from 'vitest';
import { createCitySim, rebuildDerived } from '../../src/sim/city';
import type { CitySim } from '../../src/sim/city';
import { GRID_WIDTH } from '../../src/sim/constants/map';
import { cellIndex } from '../../src/sim/grid';
import { buildDistrict, findLandBlock } from './helpers';

/** A cell owned by a grown building, plus its building entity id. */
function aBuildingCell(sim: CitySim): { cell: number; id: number } {
  for (const [cell, id] of sim.occupiedCells) {
    if (sim.world.getComponent(id, 'building')) return { cell, id };
  }
  throw new Error('no building cell');
}

function grownRDistrict(seed = 7): { sim: CitySim; base: { x: number; y: number } } {
  const sim = createCitySim({ seed, utilitiesEnabled: true });
  const base = findLandBlock(sim, 18, 10);
  buildDistrict(sim, 'R', base);
  for (let i = 0; i < 400; i++) sim.world.step();
  return { sim, base };
}

describe('power lines route through buildings', () => {
  it('places a line along a row of buildings without displacing them', () => {
    const { sim } = grownRDistrict();
    // Pick the row of a real building and gather every building on it.
    const row = Math.floor(aBuildingCell(sim).cell / GRID_WIDTH);
    const buildingsOnRow: Array<[number, number]> = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
      const cell = row * GRID_WIDTH + x;
      const id = sim.occupiedCells.get(cell);
      if (id !== undefined && sim.world.getComponent(id, 'building')) buildingsOnRow.push([cell, id]);
    }
    expect(buildingsOnRow.length).toBeGreaterThan(0); // the row really has buildings

    const xs = buildingsOnRow.map(([cell]) => cell % GRID_WIDTH);
    const ok = sim.world.submit('placePowerLine', {
      ax: Math.min(...xs),
      ay: row,
      bx: Math.max(...xs),
      by: row,
    });
    expect(ok).toBe(true);
    sim.world.step();

    for (const [cell, id] of buildingsOnRow) {
      expect(sim.powerLineCells.has(cell)).toBe(true); // line runs over the building
      expect(sim.occupiedCells.get(cell)).toBe(id); // building still owns the cell
    }
  });

  it('a line over a building survives save/load with identical derived state', () => {
    const { sim } = grownRDistrict();
    const { cell } = aBuildingCell(sim);
    const x = cell % GRID_WIDTH;
    const y = Math.floor(cell / GRID_WIDTH);
    expect(sim.world.submit('placePowerLine', { ax: x, ay: y, bx: x, by: y })).toBe(true);
    for (let i = 0; i < 40; i++) sim.world.step();

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 7, utilitiesEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    // Derived occupancy must match exactly (the divergence class from lessons.md).
    expect([...restored.occupiedCells.entries()].sort()).toEqual(
      [...sim.occupiedCells.entries()].sort(),
    );
    expect([...restored.powerLineCells.keys()].sort()).toEqual(
      [...sim.powerLineCells.keys()].sort(),
    );
    for (let i = 0; i < 200; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(JSON.stringify(sim.world.serialize()));
  });

  it('still rejects a power line over water', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    // Find a water cell and try to run a line onto it.
    let water = -1;
    for (let i = 0; i < sim.terrain.water.length; i++) {
      if (sim.terrain.water[i] === 1) {
        water = i;
        break;
      }
    }
    expect(water).toBeGreaterThanOrEqual(0);
    const wx = water % GRID_WIDTH;
    const wy = Math.floor(water / GRID_WIDTH);
    expect(sim.world.submit('placePowerLine', { ax: wx, ay: wy, bx: wx, by: wy })).toBe(false);
  });

  it('lets a plant be placed on a line cell (lines occupy nothing)', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 10);
    // Bare land line, no buildings.
    expect(sim.world.submit('placePowerLine', { ax: base.x, ay: base.y, bx: base.x + 4, by: base.y })).toBe(true);
    sim.world.step();
    const lineCell = cellIndex(base.x + 2, base.y);
    expect(sim.powerLineCells.has(lineCell)).toBe(true);
    // A line is a thin overhead overlay — a wind turbine can sit under it.
    expect(sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x + 2, y: base.y })).toBe(true);
    sim.world.step();
    expect(sim.occupiedCells.get(lineCell)).toBeDefined(); // the plant owns the cell
    expect(sim.powerLineCells.has(lineCell)).toBe(true); // the line coexists and still conducts
  });

  it('lets a road cross a line-only cell, and keeps the line when it paves a building', () => {
    const { sim, base } = grownRDistrict();
    // Line-only cell on bare ground (row far from buildings): road may cross it.
    const freeRow = base.y + 8;
    expect(sim.world.submit('placePowerLine', { ax: base.x, ay: freeRow, bx: base.x + 3, by: freeRow })).toBe(true);
    sim.world.step();
    expect(sim.world.submit('placeRoad', { ax: base.x, ay: freeRow, bx: base.x, by: freeRow })).toBe(true);

    // Building + line cell: the road paves over the growable (as a service
    // would) and the line, being an overlay that never owned the cell,
    // survives untouched and keeps conducting.
    const { cell } = aBuildingCell(sim);
    const bx = cell % GRID_WIDTH;
    const by = Math.floor(cell / GRID_WIDTH);
    expect(sim.world.submit('placePowerLine', { ax: bx, ay: by, bx: bx, by: by })).toBe(true);
    sim.world.step();
    expect(sim.world.submit('placeRoad', { ax: bx, ay: by, bx: bx, by: by })).toBe(true);
    sim.world.step();
    expect(sim.roadCells.has(cell)).toBe(true);
    expect(sim.occupiedCells.get(cell)).toBeUndefined();
    expect(sim.powerLineCells.has(cell)).toBe(true);
  });

  it('a coexisting line survives a partial building bulldoze (freed cell stays free, save/load parity)', () => {
    const { sim } = grownRDistrict();
    // A multi-cell building whose line cell we can leave OUTSIDE the bulldoze rect.
    let px = -1;
    let py = -1;
    let bw = 0;
    let bh = 0;
    for (const id of sim.world.query('building', 'position')) {
      const b = sim.world.getComponent(id, 'building');
      const p = sim.world.getComponent(id, 'position');
      if (b && p && !b.abandoned && b.w * b.h > 1) {
        px = p.x;
        py = p.y;
        bw = b.w;
        bh = b.h;
        break;
      }
    }
    expect(bw * bh).toBeGreaterThan(1);
    const lineCell = py * GRID_WIDTH + px; // top-left footprint cell
    // Line over the top-left cell; bulldoze ONLY the far (bottom-right) cell.
    expect(sim.world.submit('placePowerLine', { ax: px, ay: py, bx: px, by: py })).toBe(true);
    sim.world.step();
    expect(sim.powerLineCells.has(lineCell)).toBe(true);
    const fx = px + bw - 1;
    const fy = py + bh - 1;
    expect(fy * GRID_WIDTH + fx).not.toBe(lineCell); // the line cell is outside the rect
    expect(sim.world.submit('bulldozeRect', { ax: fx, ay: fy, bx: fx, by: fy })).toBe(true);
    sim.world.step();
    expect(sim.powerLineCells.has(lineCell)).toBe(true); // line survives (outside the rect)

    // The freed cell must read identically live and after save/load.
    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 7, utilitiesEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);
    expect(restored.occupiedCells.get(lineCell)).toBe(sim.occupiedCells.get(lineCell));
    expect([...restored.occupiedCells.entries()].sort()).toEqual(
      [...sim.occupiedCells.entries()].sort(),
    );
  });

  it('bulldozing a building+line cell clears both', () => {
    const { sim } = grownRDistrict();
    const { cell } = aBuildingCell(sim);
    const x = cell % GRID_WIDTH;
    const y = Math.floor(cell / GRID_WIDTH);
    expect(sim.world.submit('placePowerLine', { ax: x, ay: y, bx: x, by: y })).toBe(true);
    sim.world.step();
    expect(sim.powerLineCells.has(cell)).toBe(true);

    expect(sim.world.submit('bulldozeRect', { ax: x, ay: y, bx: x, by: y })).toBe(true);
    sim.world.step();
    expect(sim.powerLineCells.has(cell)).toBe(false); // line gone
    expect(sim.occupiedCells.has(cell)).toBe(false); // building gone, cell free
  });
});

/** Any building cell that also carries the given overlay, or null. */
function overlaidBuildingCell(sim: CitySim, overlay: ReadonlyMap<number, number>): number | null {
  for (const [cell, id] of sim.occupiedCells) {
    if (sim.world.getComponent(id, 'building') && overlay.has(cell)) return cell;
  }
  return null;
}

describe('utilities never occupy building space', () => {
  /**
   * Zones an R band on both sides of a road WITHOUT stepping growth, then lays
   * the given overlay along the road-adjacent row `base.y + 1` (where 1×1
   * buildings actually grow) and grows the district. Returns the overlay row.
   */
  function zoneThenOverlay(sim: CitySim, base: { x: number; y: number }, command: 'placePowerLine' | 'placePipe'): number {
    const w = sim.world;
    expect(w.submit('placeRoad', { ax: base.x, ay: base.y + 2, bx: base.x + 15, by: base.y + 2 })).toBe(true);
    w.step();
    // Zones + overlay drain in one tick, so growth first runs with the overlay
    // already present — no building can predate it on the overlay row.
    w.submit('zone', { zone: 'R', ax: base.x, ay: base.y, bx: base.x + 15, by: base.y + 1 });
    w.submit('zone', { zone: 'R', ax: base.x, ay: base.y + 3, bx: base.x + 15, by: base.y + 4 });
    const row = base.y + 1;
    expect(w.submit(command, { ax: base.x, ay: row, bx: base.x + 14, by: row })).toBe(true);
    w.step();
    for (let i = 0; i < 400; i++) w.step();
    return row;
  }

  it('a building grows on a zoned cell that carries a power line', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 10);
    zoneThenOverlay(sim, base, 'placePowerLine');
    expect(overlaidBuildingCell(sim, sim.powerLineCells)).not.toBeNull();
  });

  it('a building grows on a zoned cell that carries a water pipe', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 10);
    zoneThenOverlay(sim, base, 'placePipe');
    expect(overlaidBuildingCell(sim, sim.pipeCells)).not.toBeNull();
  });

  it('a power line claims no occupiedCells even on bare land', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 10);
    const cell = cellIndex(base.x, base.y);
    expect(
      sim.world.submit('placePowerLine', { ax: base.x, ay: base.y, bx: base.x + 4, by: base.y }),
    ).toBe(true);
    sim.world.step();
    expect(sim.powerLineCells.has(cell)).toBe(true);
    expect(sim.occupiedCells.has(cell)).toBe(false); // pure overlay — never owns a cell
  });

  it('placing a power line does not dezone the cells it runs over', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 10);
    const w = sim.world;
    w.submit('placeRoad', { ax: base.x, ay: base.y + 1, bx: base.x + 14, by: base.y + 1 });
    w.step();
    w.submit('zone', { zone: 'R', ax: base.x, ay: base.y, bx: base.x + 14, by: base.y });
    w.step();
    const cell = cellIndex(base.x, base.y);
    expect(sim.zoneCells.get(cell)).toBe('R');
    expect(w.submit('placePowerLine', { ax: base.x, ay: base.y, bx: base.x + 14, by: base.y })).toBe(
      true,
    );
    w.step();
    expect(sim.zoneCells.get(cell)).toBe('R'); // still zoned — a building may grow under the wire
  });

  it('bulldozes a lone power line on bare ground', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 10);
    const cell = cellIndex(base.x, base.y);
    expect(
      sim.world.submit('placePowerLine', { ax: base.x, ay: base.y, bx: base.x + 3, by: base.y }),
    ).toBe(true);
    sim.world.step();
    expect(sim.powerLineCells.has(cell)).toBe(true);
    expect(sim.world.submit('bulldozeRect', { ax: base.x, ay: base.y, bx: base.x, by: base.y })).toBe(
      true,
    );
    sim.world.step();
    expect(sim.powerLineCells.has(cell)).toBe(false);
  });
});
