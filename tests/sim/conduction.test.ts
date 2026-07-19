import { describe, expect, it } from 'vitest';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { UTILITY_BRIDGE_RADIUS } from '../../src/sim/constants/utilities';
import { cellIndex } from '../../src/sim/grid';
import { findLandBlock } from './helpers';

/**
 * Only purpose-built infrastructure carries a utility. Plants, pumps, lines
 * and pipes form the network; buildings draw from it but never relay it, so a
 * city must actually be wired instead of one plant lighting a whole district
 * through a chain of houses.
 */

function poweredNear(sim: CitySim, predicate: (x: number, y: number) => boolean): number {
  let count = 0;
  for (const id of sim.world.query('building', 'position')) {
    const b = sim.world.getComponent(id, 'building');
    const p = sim.world.getComponent(id, 'position');
    if (!b || !p || b.abandoned) continue;
    if (predicate(p.x, p.y) && b.powered) count++;
  }
  return count;
}

/** Long single-row residential strip fed by one road, with no utilities yet. */
function strip(sim: CitySim, length: number): { x: number; y: number } {
  const base = findLandBlock(sim, length + 6, 8);
  const y = base.y + 3;
  expect(
    sim.world.submit('placeRoad', { ax: base.x, ay: y, bx: base.x + length, by: y }),
  ).toBe(true);
  sim.world.step();
  expect(
    sim.world.submit('zone', { zone: 'R', ax: base.x, ay: y - 2, bx: base.x + length, by: y - 1 }),
  ).toBe(true);
  sim.world.step();
  for (let i = 0; i < 400; i++) sim.world.step();
  return { x: base.x, y };
}

describe('utility conduction', () => {
  it('does not relay power through buildings', () => {
    const sim = createCitySim({ seed: 3, utilitiesEnabled: true, fieldsEnabled: true });
    const LENGTH = 30;
    const { x, y } = strip(sim, LENGTH);
    expect(
      sim.world.submit('placePowerPlant', { kind: 'coal', x, y: y + 2 }),
    ).toBe(true);
    for (let i = 0; i < 200; i++) sim.world.step();

    // Buildings far along the strip are nowhere near the plant. With buildings
    // conducting they lit up anyway; they must now stay dark.
    const far = poweredNear(sim, (bx) => bx > x + UTILITY_BRIDGE_RADIUS + 6);
    expect(far).toBe(0);

    // The ones beside the plant are still served — reach itself still works.
    const near = poweredNear(sim, (bx) => bx <= x + UTILITY_BRIDGE_RADIUS);
    expect(near).toBeGreaterThan(0);
  });

  it('carries power the length of the strip once a line is run', () => {
    const sim = createCitySim({ seed: 3, utilitiesEnabled: true, fieldsEnabled: true });
    const LENGTH = 30;
    const { x, y } = strip(sim, LENGTH);
    expect(sim.world.submit('placePowerPlant', { kind: 'coal', x, y: y + 2 })).toBe(true);
    sim.world.step();
    // The line must START on the plant: conductors join the network by 4-dir
    // adjacency, so a line laid across a gap is an orphan with no source.
    expect(
      sim.world.submit('placePowerLine', {
        ax: x,
        ay: y + 2,
        bx: x + LENGTH,
        by: y + 2,
      }),
    ).toBe(true);
    for (let i = 0; i < 200; i++) sim.world.step();

    const far = poweredNear(sim, (bx) => bx > x + UTILITY_BRIDGE_RADIUS + 6);
    expect(far).toBeGreaterThan(0);
  });

  it('does not relay water through buildings either', () => {
    const sim = createCitySim({ seed: 3, utilitiesEnabled: true, fieldsEnabled: true });
    const LENGTH = 30;
    const { x, y } = strip(sim, LENGTH);
    // A pipe stub at the near end only: water must not walk down the houses.
    expect(
      sim.world.submit('placePipe', { ax: x, ay: y + 2, bx: x + 1, by: y + 2 }),
    ).toBe(true);
    for (let i = 0; i < 200; i++) sim.world.step();

    let wateredFar = 0;
    for (const id of sim.world.query('building', 'position')) {
      const b = sim.world.getComponent(id, 'building');
      const p = sim.world.getComponent(id, 'position');
      if (!b || !p || b.abandoned) continue;
      if (p.x > x + UTILITY_BRIDGE_RADIUS + 6 && b.watered) wateredFar++;
    }
    expect(wateredFar).toBe(0);
  });

  it('keeps a service building from relaying power to its neighbours', () => {
    const sim = createCitySim({ seed: 3, utilitiesEnabled: true, fieldsEnabled: true });
    const LENGTH = 30;
    const { x, y } = strip(sim, LENGTH);
    expect(sim.world.submit('placePowerPlant', { kind: 'coal', x, y: y + 2 })).toBe(true);
    sim.world.step();
    // A fire station midway used to bridge the gap by conducting.
    const midX = x + Math.floor(LENGTH / 2);
    sim.world.submit('placeService', { service: 'fireStation', x: midX, y: y + 1 });
    for (let i = 0; i < 200; i++) sim.world.step();

    const beyondStation = poweredNear(sim, (bx) => bx > midX + UTILITY_BRIDGE_RADIUS + 2);
    expect(beyondStation).toBe(0);
  });

  it('still refuses to power an island the network never reaches', () => {
    const sim = createCitySim({ seed: 3, utilitiesEnabled: true, fieldsEnabled: true });
    const { x, y } = strip(sim, 20);
    // No plant at all.
    for (let i = 0; i < 100; i++) sim.world.step();
    expect(poweredNear(sim, () => true)).toBe(0);
    expect(cellIndex(x, y)).toBeGreaterThanOrEqual(0);
  });
});
