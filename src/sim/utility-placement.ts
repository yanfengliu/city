import { footprintCells } from './buildings';
import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import {
  PIPE_COST_PER_CELL,
  POWER_LINE_COST_PER_CELL,
  POWER_PLANT_COST,
  POWER_PLANT_FOOTPRINT,
  WATER_PUMP_COST,
} from './constants/utilities';
import { scanFootprint } from './demolition';
import { purchaseAllowed } from './economy';
import { cellIndex, inBounds, lPathCells } from './grid';
import { anchorsRejection, cellLabel, refuse, spanLabel } from './rejection';
import type { CitySim } from './city';
import type {
  CityWorld,
  PlacePowerPlantCommand,
  PlaceWaterPumpCommand,
  RoadEndpoints,
} from './types';

export interface UtilityPlacementPlan {
  cells: number[];
  buildingIds: number[];
}

/** Cell indices of the L-path between a command's two endpoints. */
export function pathIndices(data: RoadEndpoints): number[] {
  return lPathCells({ x: data.ax, y: data.ay }, { x: data.bx, y: data.by }).map((c) =>
    cellIndex(c.x, c.y),
  );
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

/** Utilities may be bought into debt, so an unaffordable one is truly broke. */
export function fundsReason(label: string, cost: number): string {
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

/**
 * Cells a new power line would add, or null with a recorded reason. A line is
 * a thin overhead overlay: it crosses roads, buildings and anything else on
 * land freely — only water refuses it (unlike an underground pipe).
 */
export function powerLinePlacementPlan(
  sim: CitySim,
  w: CityWorld,
  data: RoadEndpoints,
): number[] | null {
  const offMap = anchorsRejection(data, 'power line', 'endpoint');
  if (offMap) return refuse(sim, offMap);
  const newCells = pathIndices(data).filter((i) => !sim.powerLineCells.has(i));
  if (newCells.length === 0) {
    return refuse(
      sim,
      `every cell of the path from ${spanLabel(data)} already carries a power line`,
    );
  }
  for (const i of newCells) {
    if (sim.terrain.water[i] === 1) {
      return refuse(sim, `${cellLabel(i)} is water — power lines cannot cross it`);
    }
  }
  const cost = newCells.length * POWER_LINE_COST_PER_CELL;
  if (!purchaseAllowed(w, cost, true)) {
    return refuse(sim, fundsReason(`a ${newCells.length}-cell power line`, cost));
  }
  return newCells;
}

/**
 * Cells a new pipe would add, or null with a recorded reason. Pipes run
 * underground, so they may cross terrain, water, roads and occupied cells.
 */
export function pipePlacementPlan(
  sim: CitySim,
  w: CityWorld,
  data: RoadEndpoints,
): number[] | null {
  const offMap = anchorsRejection(data, 'pipe', 'endpoint');
  if (offMap) return refuse(sim, offMap);
  const newCells = pathIndices(data).filter((i) => !sim.pipeCells.has(i));
  if (newCells.length === 0) {
    return refuse(sim, `every cell of the path from ${spanLabel(data)} already has a pipe`);
  }
  const cost = newCells.length * PIPE_COST_PER_CELL;
  if (!purchaseAllowed(w, cost, true)) {
    return refuse(sim, fundsReason(`a ${newCells.length}-cell pipe`, cost));
  }
  return newCells;
}
