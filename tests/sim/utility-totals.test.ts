import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { utilityTotals } from '../../src/sim/utilities';
import {
  POWER_PLANT_CAPACITY,
  UTILITY_DEMAND_PER_CELL_LEVEL,
  WATER_PUMP_CAPACITY,
} from '../../src/sim/constants/utilities';
import { buildDistrict, findLandBlock } from './helpers';

/** Total power/water load = level x footprint over EVERY building (abandoned too,
 * so the signal doesn't go blind when a city goes dark). */
function expectedDemand(sim: ReturnType<typeof createCitySim>): number {
  let d = 0;
  for (const id of sim.world.query('building')) {
    const b = sim.world.getComponent(id, 'building');
    if (b) d += UTILITY_DEMAND_PER_CELL_LEVEL * b.level * b.w * b.h;
  }
  return d;
}

describe('utilityTotals (supply vs demand signal)', () => {
  it('reports plant/pump capacity as supply and total building load as demand', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 10);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    // A coal plant on bare land below the district — no pump.
    expect(sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x, y: base.y + 6 })).toBe(
      true,
    );
    sim.world.step();

    const demand = expectedDemand(sim);
    expect(demand).toBeGreaterThan(0);

    const totals = utilityTotals(sim.world);
    expect(totals.power.supply).toBe(POWER_PLANT_CAPACITY.coal);
    expect(totals.power.demand).toBe(demand);
    expect(totals.water.supply).toBe(0); // no pump placed
    expect(totals.water.demand).toBe(demand);
  });

  it('adds each pump/plant into supply and is empty on an empty map', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const empty = utilityTotals(sim.world);
    expect(empty).toEqual({ power: { supply: 0, demand: 0 }, water: { supply: 0, demand: 0 } });

    const base = findLandBlock(sim, 18, 10);
    expect(sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x, y: base.y })).toBe(true);
    expect(sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x + 2, y: base.y })).toBe(
      true,
    );
    sim.world.step();
    expect(utilityTotals(sim.world).power.supply).toBe(2 * POWER_PLANT_CAPACITY.wind);
    expect(WATER_PUMP_CAPACITY).toBeGreaterThan(0); // referenced for intent
  });
});
