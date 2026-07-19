import { describe, expect, it } from 'vitest';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import { findLandBlock } from './helpers';

/**
 * A road may pave straight over growable R/C/I, exactly as a service or plant
 * does: the buildings in its way are bulldozed in full (residents evicted,
 * workers unassigned) and the road is laid. Player-placed specials still
 * block — those are deliberate investments, not something to lose to a stray
 * drag.
 */

function grownDistrict(sim: CitySim): { x: number; y: number } {
  const base = findLandBlock(sim, 20, 10);
  const y = base.y + 3;
  expect(
    sim.world.submit('placeRoad', { ax: base.x, ay: y, bx: base.x + 16, by: y }),
  ).toBe(true);
  sim.world.step();
  expect(
    sim.world.submit('zone', { zone: 'R', ax: base.x, ay: y - 2, bx: base.x + 16, by: y - 1 }),
  ).toBe(true);
  sim.world.step();
  for (let i = 0; i < 400; i++) sim.world.step();
  return { x: base.x, y };
}

/** The building entity owning a cell, or null. */
function occupantAt(sim: CitySim, x: number, y: number): number | null {
  return sim.occupiedCells.get(cellIndex(x, y)) ?? null;
}

describe('roads pave over growable buildings', () => {
  it('bulldozes a house in the way and lays the road', () => {
    const sim = createCitySim({ seed: 9, utilitiesEnabled: true, fieldsEnabled: true });
    const { x, y } = grownDistrict(sim);

    // Find a grown building on the zoned row and drive a road through it.
    let target: { x: number; y: number } | null = null;
    for (let bx = x; bx < x + 16 && !target; bx++) {
      if (occupantAt(sim, bx, y - 1) !== null) target = { x: bx, y: y - 1 };
    }
    if (!target) throw new Error('district grew no buildings to pave over');
    const entity = occupantAt(sim, target.x, target.y);
    const generationBefore = sim.world.getEntityGeneration(entity!);

    expect(
      sim.world.submit('placeRoad', {
        ax: target.x,
        ay: target.y - 1,
        bx: target.x,
        by: target.y,
      }),
    ).toBe(true);
    sim.world.step();

    // The road exists and that building is gone in full. The id may already
    // have been recycled by a building growing elsewhere in the same tick, so
    // identity is (id, generation) — never id alone.
    expect(sim.roadCells.has(cellIndex(target.x, target.y))).toBe(true);
    expect(occupantAt(sim, target.x, target.y)).toBeNull();
    const stillTheSameBuilding =
      sim.world.isAlive(entity!) && sim.world.getEntityGeneration(entity!) === generationBefore;
    expect(stillTheSameBuilding).toBe(false);
  });

  it('evicts the residents of everything it paves over', () => {
    const sim = createCitySim({ seed: 9, utilitiesEnabled: true, fieldsEnabled: true });
    const { x, y } = grownDistrict(sim);
    const homeless = (): number => {
      let count = 0;
      for (const id of sim.world.query('citizen')) {
        const c = sim.world.getComponent(id, 'citizen');
        if (c && !sim.world.isAlive(c.home)) count++;
      }
      return count;
    };
    expect(homeless()).toBe(0);

    // Pave the whole zoned row: every building on it must go.
    expect(
      sim.world.submit('placeRoad', { ax: x, ay: y - 1, bx: x + 16, by: y - 1 }),
    ).toBe(true);
    sim.world.step();
    for (let bx = x; bx <= x + 16; bx++) {
      expect(occupantAt(sim, bx, y - 1)).toBeNull();
      expect(sim.roadCells.has(cellIndex(bx, y - 1))).toBe(true);
    }
    // No citizen is left pointing at a destroyed home.
    expect(homeless()).toBe(0);
  });

  it('still refuses to pave over a player-placed service', () => {
    const sim = createCitySim({ seed: 9, utilitiesEnabled: true, fieldsEnabled: true });
    const { x, y } = grownDistrict(sim);
    expect(
      sim.world.submit('placeService', { service: 'fireStation', x: x + 2, y: y + 1 }),
    ).toBe(true);
    sim.world.step();

    expect(
      sim.world.submit('placeRoad', { ax: x + 2, ay: y + 1, bx: x + 3, by: y + 1 }),
    ).toBe(false);
    expect(sim.lastRejection).toMatch(/fire station/i);
    expect(sim.lastRejection).toContain(`${x + 2}`);
  });

  it('charges only for the road, not a demolition fee', () => {
    const sim = createCitySim({ seed: 9, utilitiesEnabled: true, fieldsEnabled: true });
    const { x, y } = grownDistrict(sim);
    let target: number | null = null;
    for (let bx = x; bx < x + 16 && target === null; bx++) {
      if (occupantAt(sim, bx, y - 1) !== null) target = bx;
    }
    if (target === null) throw new Error('no building to pave over');

    const before = sim.world.getState('treasury') as number;
    expect(
      sim.world.submit('placeRoad', { ax: target, ay: y - 1, bx: target, by: y - 1 }),
    ).toBe(true);
    sim.world.step();
    const spent = before - (sim.world.getState('treasury') as number);
    // Exactly one land road cell: same price as paving empty ground.
    expect(spent).toBe(10);
  });
});
