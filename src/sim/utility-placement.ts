import { footprintCells } from './buildings';
import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import {
  POWER_PLANT_COST,
  POWER_PLANT_FOOTPRINT,
  WATER_PUMP_COST,
} from './constants/utilities';
import { replacementBuildingIds } from './demolition';
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

export function powerPlantPlacementPlan(
  sim: CitySim,
  w: CityWorld,
  data: PlacePowerPlantCommand,
): UtilityPlacementPlan | null {
  if (data.kind !== 'coal' && data.kind !== 'wind') return null;
  const side = POWER_PLANT_FOOTPRINT[data.kind];
  if (
    !inBounds(data.x, data.y, GRID_WIDTH, GRID_HEIGHT) ||
    !inBounds(data.x + side - 1, data.y + side - 1, GRID_WIDTH, GRID_HEIGHT)
  ) {
    return null;
  }
  const cells = footprintCells(data.x, data.y, side, side);
  const buildingIds = replacementBuildingIds(sim, w, cells);
  if (buildingIds === null || !purchaseAllowed(w, POWER_PLANT_COST[data.kind], true)) return null;
  return { cells, buildingIds };
}

export function waterPumpPlacementPlan(
  sim: CitySim,
  w: CityWorld,
  data: PlaceWaterPumpCommand,
): UtilityPlacementPlan | null {
  if (!inBounds(data.x, data.y, GRID_WIDTH, GRID_HEIGHT)) return null;
  const cells = [cellIndex(data.x, data.y)];
  const buildingIds = replacementBuildingIds(sim, w, cells);
  if (buildingIds === null || !orthAdjacentToWater(sim, data.x, data.y)) return null;
  if (!purchaseAllowed(w, WATER_PUMP_COST, true)) return null;
  return { cells, buildingIds };
}
