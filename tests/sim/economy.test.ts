import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury } from '../../src/sim/city';
import { BUDGET_INTERVAL_TICKS } from '../../src/sim/constants/map';
import { MAX_TAX_RATE, RETAIL_SPEND_PER_VISIT } from '../../src/sim/constants/economy';
import { buildDistrict, findLandBlock } from './helpers';
import type { CitySim } from '../../src/sim/city';
import type { BudgetReport, CityState, DemandState } from '../../src/sim/types';

type RetailCounterState = Pick<
  CityState,
  'pendingRetailVisits' | 'completedShoppingTrips'
>;

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

function nextBudgetReport(sim: CitySim): BudgetReport {
  let captured: BudgetReport | undefined;
  const listener = (report: BudgetReport): void => {
    captured = report;
  };
  sim.world.on('budget', listener);
  try {
    for (let i = 0; i <= BUDGET_INTERVAL_TICKS; i++) {
      sim.world.step();
      if (captured !== undefined) return captured;
    }
    throw new Error('budget interval elapsed without a budget report');
  } finally {
    sim.world.off('budget', listener);
  }
}

function retailCounters(sim: CitySim): RetailCounterState {
  return {
    pendingRetailVisits: sim.world.getState('pendingRetailVisits') as number,
    completedShoppingTrips: sim.world.getState('completedShoppingTrips') as number,
  };
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

describe('retail budget', () => {
  it('initializes pending and completed shopping counters at zero', () => {
    const sim = createCitySim({ seed: 7 });

    expect(retailCounters(sim)).toEqual({
      pendingRetailVisits: 0,
      completedShoppingTrips: 0,
    });
  });

  it('settles pending visits once as separately reported commercial-tax income', () => {
    const sim = createCitySim({ seed: 7 });
    const visits = 7;
    const commercialTaxRate = 13;
    expect(sim.world.submit('setTaxRate', { zone: 'C', rate: commercialTaxRate })).toBe(true);
    sim.world.runMaintenance(() => {
      sim.world.setState('pendingRetailVisits', visits);
      sim.world.setState('completedShoppingTrips', visits);
    });
    const before = getTreasury(sim.world);
    const expectedRetailIncome =
      visits * RETAIL_SPEND_PER_VISIT * (commercialTaxRate / 100);

    const first = nextBudgetReport(sim);

    expect(first.retailIncome).toBeCloseTo(expectedRetailIncome, 10);
    expect(first.income).toBeCloseTo(expectedRetailIncome, 10);
    expect(getTreasury(sim.world) - before).toBeCloseTo(expectedRetailIncome, 10);
    expect(retailCounters(sim)).toEqual({
      pendingRetailVisits: 0,
      completedShoppingTrips: visits,
    });

    const beforeSecondSettlement = getTreasury(sim.world);
    const second = nextBudgetReport(sim);

    expect(second.retailIncome).toBe(0);
    expect(second.income).toBe(0);
    expect(getTreasury(sim.world)).toBe(beforeSecondSettlement);
    expect(retailCounters(sim)).toEqual({
      pendingRetailVisits: 0,
      completedShoppingTrips: visits,
    });
  });

  it('consumes pending visits without retail income when commercial tax is zero', () => {
    const sim = createCitySim({ seed: 7 });
    const visits = 5;
    expect(sim.world.submit('setTaxRate', { zone: 'C', rate: 0 })).toBe(true);
    sim.world.runMaintenance(() => {
      sim.world.setState('pendingRetailVisits', visits);
      sim.world.setState('completedShoppingTrips', visits);
    });
    const before = getTreasury(sim.world);

    const report = nextBudgetReport(sim);

    expect(report.retailIncome).toBe(0);
    expect(report.income).toBe(0);
    expect(getTreasury(sim.world)).toBe(before);
    expect(retailCounters(sim)).toEqual({
      pendingRetailVisits: 0,
      completedShoppingTrips: visits,
    });
  });
});
