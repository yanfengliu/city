import { evictCitizens, footprintCells } from './buildings';
import { REGROWTH_COOLDOWN_TICKS } from './constants/zoning';
import { SERVICE_LABELS } from './constants/services';
import { unassignWorkers } from './employment';
import { cellFromIndex } from './grid';
import type { CitySim } from './city';
import type { CityWorld } from './types';

/** Footprint scan outcome; the failure arm carries a player-facing reason. */
export type FootprintScan =
  | { ok: true; buildingIds: number[] }
  | { ok: false; reason: string };

/** "(x, y)" for a cell index — every rejection names the cell that blocked it. */
export function cellLabel(cell: number): string {
  const { x, y } = cellFromIndex(cell);
  return `(${x}, ${y})`;
}

/** Human name for whatever already owns a cell, for rejection messages. */
function occupantLabel(w: CityWorld, occupant: number): string {
  const structure = w.getComponent(occupant, 'structure');
  if (structure) return SERVICE_LABELS[structure.type] ?? 'a service building';
  const plant = w.getComponent(occupant, 'powerPlant');
  if (plant) return plant.kind === 'wind' ? 'a wind turbine' : 'a coal power plant';
  if (w.getComponent(occupant, 'waterPump')) return 'a water pump';
  return 'another structure';
}

/**
 * Plans a footprint placement without mutating the world. Empty cells and
 * growable R/C/I owners are allowed; water, roads, and every other occupancy
 * owner fail closed with a reason naming the offending cell. Power lines and
 * pipes never appear in occupiedCells, so they remain compatible and survive
 * the replacement.
 */
export function scanFootprint(
  sim: CitySim,
  w: CityWorld,
  cells: readonly number[],
): FootprintScan {
  const buildings = new Set<number>();
  for (const cell of cells) {
    if (sim.terrain.water[cell] === 1) {
      return { ok: false, reason: `${cellLabel(cell)} is water — build on dry land` };
    }
    if (sim.roadCells.has(cell)) {
      return { ok: false, reason: `${cellLabel(cell)} is a road — clear it or shift the footprint` };
    }
    const occupant = sim.occupiedCells.get(cell);
    if (occupant === undefined) continue;
    if (!w.getComponent(occupant, 'building')) {
      return {
        ok: false,
        reason: `${cellLabel(cell)} is occupied by ${occupantLabel(w, occupant)} — bulldoze it first`,
      };
    }
    buildings.add(occupant);
  }
  return { ok: true, buildingIds: [...buildings].sort((a, b) => a - b) };
}

/**
 * Applies the growable-building part of bulldozeRect to whole entity
 * footprints. Zoning remains untouched; rubble prevents exposed remainder
 * cells from regrowing during the same tick as a partial-footprint replacement.
 */
export function bulldozeGrowableBuildings(
  sim: CitySim,
  w: CityWorld,
  buildingIds: Iterable<number>,
): void {
  const ids = [...new Set(buildingIds)].sort((a, b) => a - b);
  if (ids.length === 0) return;

  const rubble = {
    ...((w.getState('regrowthBlock') as Record<string, number> | undefined) ?? {}),
  };
  let rubbleChanged = false;
  for (const id of ids) {
    const building = w.getComponent(id, 'building');
    const position = w.getComponent(id, 'position');
    evictCitizens(w, id);
    unassignWorkers(sim, w, id);
    if (building && position) {
      for (const cell of footprintCells(position.x, position.y, building.w, building.h)) {
        if (sim.occupiedCells.get(cell) === id) sim.occupiedCells.delete(cell);
        rubble[String(cell)] = w.tick + REGROWTH_COOLDOWN_TICKS;
        rubbleChanged = true;
      }
    }
    w.destroyEntity(id);
  }
  if (rubbleChanged) w.setState('regrowthBlock', rubble);
}
