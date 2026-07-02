import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury } from '../../src/sim/city';
import { BUDGET_INTERVAL_TICKS } from '../../src/sim/constants/map';
import { MAX_TAX_RATE } from '../../src/sim/constants/economy';
import { buildDistrict, findLandBlock } from './helpers';
import type { CitySim } from '../../src/sim/city';
import type { DemandState } from '../../src/sim/types';

function grownTown(seed: number, taxRate?: number): CitySim {
  const sim = createCitySim({ seed });
  const base = findLandBlock(sim, 18, 18);
  buildDistrict(sim, 'R', base);
  buildDistrict(sim, 'I', { x: base.x, y: base.y + 10 });
  if (taxRate !== undefined) {
    for (const zone of ['R', 'C', 'I'] as const) {
      expect(sim.world.submit('setTaxRate', { zone, rate: taxRate })).toBe(true);
    }
  }
  return sim;
}

describe('budget', () => {
  it('applies income minus expenses on the budget cadence', () => {
    const sim = grownTown(7);
    // Let the town grow well past the first budget tick.
    const before = getTreasury(sim.world);
    for (let i = 0; i < BUDGET_INTERVAL_TICKS + 64; i++) sim.world.step();
    const after = getTreasury(sim.world);
    // Buildings grew and pay taxes; road upkeep is small — the budget moved the treasury
    // beyond the road/zone purchase debits (which happened before `before` was read).
    expect(after).not.toBe(before);
  });

  it('tax rate 0 yields less income than the default 9', () => {
    const run = (rate: number) => {
      const sim = grownTown(7, rate);
      for (let i = 0; i < BUDGET_INTERVAL_TICKS + 64; i++) sim.world.step();
      return getTreasury(sim.world);
    };
    expect(run(0)).toBeLessThan(run(9));
  });

  it('max taxes suppress demand', () => {
    const readDemand = (rate: number): DemandState => {
      const sim = grownTown(7, rate);
      for (let i = 0; i < 320; i++) sim.world.step();
      return sim.world.getState('demand') as DemandState;
    };
    const normal = readDemand(9);
    const taxed = readDemand(MAX_TAX_RATE);
    expect(taxed.r).toBeLessThan(normal.r);
  });

  it('rejects out-of-range tax rates', () => {
    const sim = createCitySim({ seed: 7 });
    expect(sim.world.submit('setTaxRate', { zone: 'R', rate: 21 })).toBe(false);
    expect(sim.world.submit('setTaxRate', { zone: 'R', rate: -1 })).toBe(false);
    expect(sim.world.submit('setTaxRate', { zone: 'R', rate: 15 })).toBe(true);
  });
});
