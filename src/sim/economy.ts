import {
  BRIDGE_UPKEEP_PER_CELL,
  MAX_TAX_RATE,
  MIN_TAX_RATE,
  RETAIL_SPEND_PER_VISIT,
  ROAD_UPKEEP_PER_CELL,
  TAX_BASE,
  TAX_DEMAND_PENALTY_PER_POINT,
  TAX_PENALTY_PER_POINT,
} from './constants/economy';
import { SERVICE_UPKEEP } from './constants/services';
import { POWER_PLANT_UPKEEP, WATER_PUMP_UPKEEP } from './constants/utilities';
import { DEFAULT_TAX_RATE } from './constants/zoning';
import type { CitySim } from './city';
import type { CityWorld, TaxRates, ZoneType } from './types';

/** Local copy of city.ts getTreasury — avoids a runtime import cycle city ⇄ economy. */
function treasury(w: CityWorld): number {
  return (w.getState('treasury') as number | undefined) ?? 0;
}

/**
 * Shared purchase gate for every placement validator. While the treasury is
 * negative ("broke"), ONLY power/water items may be bought (at any cost, going
 * further negative) — a broke, unpowered city otherwise has no income path and
 * would soft-lock unrecoverably. When solvent, cost must be covered in full.
 */
export function purchaseAllowed(w: CityWorld, cost: number, isUtility: boolean): boolean {
  const funds = treasury(w);
  if (funds < 0) return isUtility;
  return funds >= cost;
}

const RATE_KEY: Record<ZoneType, keyof TaxRates> = { R: 'r', C: 'c', I: 'i' };

export function taxRateOf(w: CityWorld, zone: ZoneType): number {
  const rates = w.getState('taxRates') as TaxRates | undefined;
  return rates ? rates[RATE_KEY[zone]] : DEFAULT_TAX_RATE;
}

/** Desirability penalty from taxes (0 at or below the default rate). */
export function taxPenaltyOf(w: CityWorld, zone: ZoneType): number {
  return TAX_PENALTY_PER_POINT * Math.max(0, taxRateOf(w, zone) - DEFAULT_TAX_RATE);
}

/** Demand penalty from taxes (0 at or below the default rate). */
export function taxDemandPenaltyOf(w: CityWorld, zone: ZoneType): number {
  return TAX_DEMAND_PENALTY_PER_POINT * Math.max(0, taxRateOf(w, zone) - DEFAULT_TAX_RATE);
}

export function registerEconomyCommands(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('setTaxRate', (data) => {
    if (data.zone !== 'R' && data.zone !== 'C' && data.zone !== 'I') return false;
    return Number.isInteger(data.rate) && data.rate >= MIN_TAX_RATE && data.rate <= MAX_TAX_RATE;
  });

  world.registerHandler('setTaxRate', (data, w) => {
    const rates = (w.getState('taxRates') as TaxRates | undefined) ?? {
      r: DEFAULT_TAX_RATE,
      c: DEFAULT_TAX_RATE,
      i: DEFAULT_TAX_RATE,
    };
    w.setState('taxRates', { ...rates, [RATE_KEY[data.zone]]: data.rate });
  });
}

/**
 * Budget settlement, once per budget interval. Income taxes every
 * non-abandoned building; expenses cover service/plant/pump upkeep and road
 * upkeep. The net applies to the treasury (which may go negative) and a
 * 'budget' event reports the totals for the UI.
 */
export function budgetSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const pendingRetailVisits =
      (w.getState('pendingRetailVisits') as number | undefined) ?? 0;
    const retailIncome =
      pendingRetailVisits * RETAIL_SPEND_PER_VISIT * (taxRateOf(w, 'C') / 100);
    let income = retailIncome;
    // Sorted iteration: float accumulation order is part of determinism.
    for (const id of [...w.query('building')].sort((a, b) => a - b)) {
      const building = w.getComponent(id, 'building');
      if (!building || building.abandoned) continue;
      income +=
        (taxRateOf(w, building.zone) / 100) *
        TAX_BASE[building.zone] *
        building.level *
        building.w *
        building.h;
    }

    let expenses = 0;
    for (const id of [...w.query('structure')].sort((a, b) => a - b)) {
      const structure = w.getComponent(id, 'structure');
      if (structure) expenses += SERVICE_UPKEEP[structure.type];
    }
    for (const id of [...w.query('powerPlant')].sort((a, b) => a - b)) {
      const plant = w.getComponent(id, 'powerPlant');
      if (plant) expenses += POWER_PLANT_UPKEEP[plant.kind];
    }
    for (const id of w.query('waterPump')) {
      void id;
      expenses += WATER_PUMP_UPKEEP;
    }
    let bridgeCells = 0;
    for (const i of sim.roadCells) {
      if (sim.terrain.water[i] === 1) bridgeCells++;
    }
    expenses +=
      ROAD_UPKEEP_PER_CELL * (sim.roadCells.size - bridgeCells) +
      BRIDGE_UPKEEP_PER_CELL * bridgeCells;

    w.setState('pendingRetailVisits', 0);
    w.setState('treasury', treasury(w) + income - expenses);
    w.emit('budget', { income, expenses, retailIncome });
  };
}
