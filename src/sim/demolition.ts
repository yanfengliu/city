import { evictCitizens, footprintCells } from './buildings';
import { REGROWTH_COOLDOWN_TICKS } from './constants/zoning';
import { unassignWorkers } from './employment';
import type { CitySim } from './city';
import type { CityWorld } from './types';

/**
 * Plans a footprint placement without mutating the world. Empty cells and
 * growable R/C/I owners are allowed; water, roads, and every other occupancy
 * owner fail closed. Power lines and pipes never appear in occupiedCells, so
 * they remain compatible and survive the replacement.
 */
export function replacementBuildingIds(
  sim: CitySim,
  w: CityWorld,
  cells: readonly number[],
): number[] | null {
  const buildings = new Set<number>();
  for (const cell of cells) {
    if (sim.terrain.water[cell] === 1 || sim.roadCells.has(cell)) return null;
    const occupant = sim.occupiedCells.get(cell);
    if (occupant === undefined) continue;
    if (!w.getComponent(occupant, 'building')) return null;
    buildings.add(occupant);
  }
  return [...buildings].sort((a, b) => a - b);
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
