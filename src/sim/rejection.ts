import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import { SERVICE_LABELS } from './constants/services';
import { cellFromIndex, inBounds } from './grid';
import type { CitySim } from './city';
import type { CityWorld, RectArea, ZoneType } from './types';

/**
 * The shared vocabulary of command refusals. AGENTS.md: error messages are a
 * product surface — a rejection names the offending input, the rule it broke,
 * and what would satisfy it, so a player (or a playtest agent) can act on it
 * without reading the source.
 *
 * `sim.lastRejection` is diagnostic only: never read by simulation logic, never
 * serialized, and cleared by every submit — so recording a reason can never
 * influence determinism or replay.
 */

/** Records why a command was refused; returns null for `Plan | null` planners. */
export function refuse(sim: CitySim, reason: string): null {
  sim.lastRejection = reason;
  return null;
}

/** Records why a command was refused, for validators that answer a bare boolean. */
export function deny(sim: CitySim, reason: string): false {
  sim.lastRejection = reason;
  return false;
}

/** "(x, y)" for a cell index — every rejection names the cell that blocked it. */
export function cellLabel(cell: number): string {
  const { x, y } = cellFromIndex(cell);
  return `(${x}, ${y})`;
}

/** "(ax, ay) to (bx, by)" — names the span an area-wide refusal covered. */
export function spanLabel(area: RectArea): string {
  return `(${area.ax}, ${area.ay}) to (${area.bx}, ${area.by})`;
}

/** Player-facing zone names, shared by refusals and the citizen detail panel. */
export const ZONE_NAMES: Record<ZoneType, string> = {
  R: 'residential',
  C: 'commercial',
  I: 'industrial',
};

/** Human name for whatever already owns a cell, for rejection messages. */
export function occupantLabel(w: CityWorld, occupant: number): string {
  const structure = w.getComponent(occupant, 'structure');
  if (structure) return SERVICE_LABELS[structure.type] ?? 'a service building';
  const plant = w.getComponent(occupant, 'powerPlant');
  if (plant) return plant.kind === 'wind' ? 'a wind turbine' : 'a coal power plant';
  if (w.getComponent(occupant, 'waterPump')) return 'a water pump';
  // Buildings own occupiedCells too. scanFootprint filters them out before
  // asking (it replaces growables), but roads and zoning are blocked by them.
  const building = w.getComponent(occupant, 'building');
  if (building) return `a level ${building.level} ${ZONE_NAMES[building.zone]} building`;
  return 'another structure';
}

/** Coordinate guidance shared by every off-map refusal. */
const ON_MAP = `whole coordinates from (0, 0) to (${GRID_WIDTH - 1}, ${GRID_HEIGHT - 1})`;

/**
 * Reason a command's two anchor cells are unusable, or null when both are on
 * the map. `subject` names what is being placed ("road", "zoning area") and
 * `noun` what the anchors are ("endpoint" for an L-path, "corner" for a rect).
 * RoadEndpoints and RectArea are the same {ax, ay, bx, by} shape, so both fit.
 */
export function anchorsRejection(area: RectArea, subject: string, noun: string): string | null {
  for (const [x, y] of [
    [area.ax, area.ay],
    [area.bx, area.by],
  ]) {
    if (!inBounds(x, y, GRID_WIDTH, GRID_HEIGHT)) {
      return (
        `${subject} ${noun} (${x}, ${y}) is not a cell on the ${GRID_WIDTH}x${GRID_HEIGHT} ` +
        `map — use ${ON_MAP}`
      );
    }
  }
  return null;
}
