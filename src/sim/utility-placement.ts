import { footprintCells } from './buildings';
import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import {
  POWER_PLANT_COST,
  POWER_PLANT_FOOTPRINT,
  WATER_PUMP_COST,
} from './constants/utilities';
import { scanFootprint } from './demolition';
import { purchaseAllowed } from './economy';
import { cellIndex, inBounds } from './grid';
import type { CitySim } from './city';
import type { CityWorld, PlacePowerPlantCommand, PlaceWaterPumpCommand } from './types';

export interface UtilityPlacementPlan {
  cells: number[];
  buildingIds: number[];
}

function orthAdjacentToWater(sim: CitySim, x: number, y: number): boolean {
  for (const [nx, ny] of [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ]) {
    if (inBounds(nx, ny, GRID_WIDTH, GRID_HEIGHT) && sim.terrain.water[cellIndex(nx, ny)] === 1) {
      return true;
    }
  }
  return false;
}

/** Records why a placement failed, then reports the failure to the engine. */
function refuse(sim: CitySim, reason: string): null {
  sim.lastRejection = reason;
  return null;
}

/** Utilities may be bought into debt, so an unaffordable one is truly broke. */
function fundsReason(label: string, cost: number): string {
  return `${label} costs $${cost} and the treasury is already in debt`;
}

export function powerPlantPlacementPlan(
  sim: CitySim,
  w: CityWorld,
  data: PlacePowerPlantCommand,
): UtilityPlacementPlan | null {
  if (data.kind !== 'coal' && data.kind !== 'wind') {
    return refuse(sim, `unknown power plant kind "${data.kind}" — expected coal or wind`);
  }
  const side = POWER_PLANT_FOOTPRINT[data.kind];
  if (
    !inBounds(data.x, data.y, GRID_WIDTH, GRID_HEIGHT) ||
    !inBounds(data.x + side - 1, data.y + side - 1, GRID_WIDTH, GRID_HEIGHT)
  ) {
    return refuse(
      sim,
      `a ${side}x${side} ${data.kind} plant anchored at (${data.x}, ${data.y}) ` +
        `falls outside the ${GRID_WIDTH}x${GRID_HEIGHT} map`,
    );
  }
  const cells = footprintCells(data.x, data.y, side, side);
  const scan = scanFootprint(sim, w, cells);
  if (!scan.ok) return refuse(sim, scan.reason);
  if (!purchaseAllowed(w, POWER_PLANT_COST[data.kind], true)) {
    return refuse(sim, fundsReason(`a ${data.kind} plant`, POWER_PLANT_COST[data.kind]));
  }
  return { cells, buildingIds: scan.buildingIds };
}

export function waterPumpPlacementPlan(
  sim: CitySim,
  w: CityWorld,
  data: PlaceWaterPumpCommand,
): UtilityPlacementPlan | null {
  if (!inBounds(data.x, data.y, GRID_WIDTH, GRID_HEIGHT)) {
    return refuse(
      sim,
      `(${data.x}, ${data.y}) falls outside the ${GRID_WIDTH}x${GRID_HEIGHT} map`,
    );
  }
  const cells = [cellIndex(data.x, data.y)];
  const scan = scanFootprint(sim, w, cells);
  if (!scan.ok) return refuse(sim, scan.reason);
  if (!orthAdjacentToWater(sim, data.x, data.y)) {
    return refuse(
      sim,
      `(${data.x}, ${data.y}) has no water beside it — a pump must sit on a shore cell`,
    );
  }
  if (!purchaseAllowed(w, WATER_PUMP_COST, true)) {
    return refuse(sim, fundsReason('a water pump', WATER_PUMP_COST));
  }
  return { cells, buildingIds: scan.buildingIds };
}
