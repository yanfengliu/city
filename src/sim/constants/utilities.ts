import type { PowerPlantKind } from '../types';

/** Power flood-fill cadence (see game-design.md cadence list). */
export const POWER_INTERVAL = 8;
export const POWER_INTERVAL_OFFSET = 7;
/** Water flood-fill cadence. */
export const WATER_INTERVAL = 8;
export const WATER_INTERVAL_OFFSET = 1;

/** Plants occupy a square footprint of this side, anchored top-left. */
export const POWER_PLANT_FOOTPRINT: Record<PowerPlantKind, number> = {
  coal: 3,
  wind: 1,
};

export const POWER_PLANT_COST: Record<PowerPlantKind, number> = {
  coal: 800,
  wind: 300,
};

/** Upkeep per budget interval — consumed by the budget system. */
export const POWER_PLANT_UPKEEP: Record<PowerPlantKind, number> = {
  coal: 16,
  wind: 6,
};

/** Power units supplied to the plant's connected network. */
export const POWER_PLANT_CAPACITY: Record<PowerPlantKind, number> = {
  coal: 400,
  wind: 40,
};

/** Power lines have no upkeep. */
export const POWER_LINE_COST_PER_CELL = 4;
/** Pipes have no upkeep. */
export const PIPE_COST_PER_CELL = 3;

export const WATER_PUMP_COST = 500;
/** Upkeep per budget interval. */
export const WATER_PUMP_UPKEEP = 10;
/** Water units supplied to the pump's connected network. */
export const WATER_PUMP_CAPACITY = 300;

/**
 * A building/structure footprint joins a conduction network when any footprint
 * cell is within this Chebyshev distance of a network cell.
 */
export const UTILITY_BRIDGE_RADIUS = 3;

/** Power/water demand per building = this x level x footprint cells. */
export const UTILITY_DEMAND_PER_CELL_LEVEL = 1;

/** Added at each coal plant's anchor block with the industrial radial falloff. */
export const COAL_PLANT_POLLUTION = 30;
