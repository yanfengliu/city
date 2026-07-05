import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { countBuildings, stats } from './helpers';
import type { CityCommands, ZoneType } from '../../src/sim/types';

/**
 * v1 acceptance gate (game-design.md § "Definition of fully functioning"): from
 * an empty map, a balanced road-grid city grows to the ≥ 1,000-population target
 * with commuting traffic. The city routes over the map's scattered lakes as
 * bridges — the terrain is ~83% land but fragments large rectangles, so real
 * scale comes from a grid, not one block.
 *
 * Scope: this pins population SCALE + traffic. The power/water gating,
 * congestion/relief, budget broke→recover, save/load, and determinism criteria
 * each have their own gate (utilities/congestion/economy/replay tests), so this
 * runs utilities off (neutral powered/watered) with unlimited treasury to
 * isolate the one property none of them cover — that the sim actually reaches
 * the acceptance population.
 */
describe('v1 acceptance', () => {
  it('reaches ≥ 1,000 population with commuting traffic', { timeout: 120_000 }, () => {
    const sim = createCitySim({ seed: 3, fieldsEnabled: true });
    sim.world.runMaintenance(() => sim.world.setState('treasury', 10_000_000));

    const x0 = 8;
    const x1 = 92;
    const y0 = 8;
    const y1 = 68;
    const submit = (name: keyof CityCommands, data: object): void => {
      sim.world.submit(name, data as never);
    };
    // Road grid — horizontal streets every 4 rows, verticals every 12 cols.
    for (let y = y0; y <= y1; y += 4) submit('placeRoad', { ax: x0, ay: y, bx: x1, by: y });
    for (let x = x0; x <= x1; x += 12) submit('placeRoad', { ax: x, ay: y0, bx: x, by: y1 });
    sim.world.step();
    // Balanced zoning per band: R-leaning, jobs interspersed so R demand holds.
    const pattern: ZoneType[] = ['R', 'R', 'C', 'R', 'I', 'R', 'C', 'R', 'I', 'R', 'R', 'C', 'I', 'R', 'R', 'I'];
    let k = 0;
    for (let y = y0; y < y1; y += 4) {
      submit('zone', { zone: pattern[k % pattern.length], ax: x0, ay: y + 1, bx: x1, by: y + 3 });
      k++;
    }
    sim.world.step();

    let peakVehicles = 0;
    for (let i = 0; i < 3000; i++) {
      sim.world.step();
      if (i % 50 === 0) peakVehicles = Math.max(peakVehicles, stats(sim).vehicles);
    }

    const s = stats(sim);
    const buildings = countBuildings(sim);
    const population = s.citizens * 3; // PEOPLE_PER_CITIZEN
    // The headline v1 target.
    expect(population).toBeGreaterThanOrEqual(1000);
    // Buildings of all three zones grew (a real mixed city, not one giant R block).
    expect(buildings.R).toBeGreaterThan(0);
    expect(buildings.C).toBeGreaterThan(0);
    expect(buildings.I).toBeGreaterThan(0);
    // Citizens are employed and commuting — "visibly moving traffic".
    expect(s.employed).toBeGreaterThan(0);
    expect(peakVehicles).toBeGreaterThan(0);
    expect(s.disconnected).toBe(0); // the grid is fully connected — no stranded trips
  });
});
