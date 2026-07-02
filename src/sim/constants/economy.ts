import type { ZoneType } from '../types';

export const STARTING_TREASURY = 20000;
export const ROAD_COST_PER_CELL = 10;
/** A road cell on water builds as a bridge at this premium (per cell). */
export const BRIDGE_COST_PER_CELL = 40;
export const ROAD_BULLDOZE_REFUND = 0.25;

/**
 * Budget cadence: interval BUDGET_INTERVAL_TICKS (constants/map.ts). Offset
 * puts the FIRST budget at tick 1024 rather than tick 1 (offset 0 would
 * charge upkeep on the very first tick of a new city).
 */
export const BUDGET_INTERVAL_OFFSET = 1023;
/** Income per building = taxRate/100 x TAX_BASE x level x footprint cells. */
export const TAX_BASE: Record<ZoneType, number> = { R: 20, C: 30, I: 30 };
/** Road upkeep per land cell per budget interval (the authoritative value). */
export const ROAD_UPKEEP_PER_CELL = 0.1;
/** Bridge upkeep per water road cell per budget interval. */
export const BRIDGE_UPKEEP_PER_CELL = 0.4;
/** Tax sliders are integer percent within [MIN_TAX_RATE, MAX_TAX_RATE]. */
export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 20;
/** Desirability penalty per tax point above the default rate. */
export const TAX_PENALTY_PER_POINT = 2;
/** Demand penalty per tax point above the default rate. */
export const TAX_DEMAND_PENALTY_PER_POINT = 0.05;
