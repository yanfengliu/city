import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import { ZONE_MAX_ROAD_DISTANCE } from './constants/zoning';
import { cellIndex, inBounds } from './grid';
import { anchorsRejection, cellLabel, deny, occupantLabel, spanLabel } from './rejection';
import type { CitySim } from './city';
import type { CityWorld, RectArea, ZoneType } from './types';

export function rectCells(area: RectArea): Array<{ x: number; y: number }> {
  const x0 = Math.min(area.ax, area.bx);
  const x1 = Math.max(area.ax, area.bx);
  const y0 = Math.min(area.ay, area.by);
  const y1 = Math.max(area.ay, area.by);
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) cells.push({ x, y });
  }
  return cells;
}

export function nearRoad(sim: CitySim, x: number, y: number): boolean {
  for (let dy = -ZONE_MAX_ROAD_DISTANCE; dy <= ZONE_MAX_ROAD_DISTANCE; dy++) {
    for (let dx = -ZONE_MAX_ROAD_DISTANCE; dx <= ZONE_MAX_ROAD_DISTANCE; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny, GRID_WIDTH, GRID_HEIGHT)) continue;
      if (sim.roadCells.has(cellIndex(nx, ny))) return true;
    }
  }
  return false;
}

export function zoneEligible(sim: CitySim, x: number, y: number): boolean {
  const i = cellIndex(x, y);
  return (
    sim.terrain.water[i] === 0 &&
    !sim.roadCells.has(i) &&
    !sim.occupiedCells.has(i) &&
    !sim.zoneCells.has(i) &&
    nearRoad(sim, x, y)
  );
}

/**
 * Why one cell cannot be zoned. Kept separate from the cheap zoneEligible
 * predicate and called only for the single cell a refusal names, so painting a
 * large area never builds a string per cell.
 */
function zoneRejection(sim: CitySim, x: number, y: number): string {
  const i = cellIndex(x, y);
  if (sim.terrain.water[i] === 1) return `${cellLabel(i)} is water — zone dry land`;
  if (sim.roadCells.has(i)) return `${cellLabel(i)} is a road`;
  const occupant = sim.occupiedCells.get(i);
  if (occupant !== undefined) {
    return `${cellLabel(i)} is occupied by ${occupantLabel(sim.world, occupant)} — bulldoze it first`;
  }
  const zone = sim.zoneCells.get(i);
  if (zone !== undefined) return `${cellLabel(i)} is already zoned ${zone} — dezone it first`;
  return `${cellLabel(i)} is more than ${ZONE_MAX_ROAD_DISTANCE} cells from a road`;
}

/** Recomputes the zone-cell map from zoneCell entities. */
export function refreshZones(sim: CitySim): void {
  const zones = new Map<number, ZoneType>();
  for (const id of sim.world.query('zoneCell', 'position')) {
    const position = sim.world.getComponent(id, 'position');
    const zone = sim.world.getComponent(id, 'zoneCell');
    if (position && zone) zones.set(cellIndex(position.x, position.y), zone.zone);
  }
  sim.zoneCells = zones;
}

/**
 * Destroys zone entities under freshly claimed cells — a road may be placed
 * over zoned land and dezones it as it lands. (Power lines and pipes are thin
 * overlays and deliberately do NOT dezone — a building grows under them.)
 */
export function dezoneCells(sim: CitySim, w: CityWorld, cells: number[]): void {
  let changed = false;
  for (const i of cells) {
    const entity = sim.zoneEntities.get(i);
    if (entity !== undefined) {
      w.destroyEntity(entity);
      sim.zoneEntities.delete(i);
      changed = true;
    }
  }
  if (changed) {
    refreshZones(sim);
    w.emit('zonesChanged', {});
  }
}

export function registerZoneCommands(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('zone', (data) => {
    const offMap = anchorsRejection(data, 'zoning area', 'corner');
    if (offMap) return deny(sim, offMap);
    const cells = rectCells(data);
    if (cells.some((c) => zoneEligible(sim, c.x, c.y))) return true;
    // Nothing was eligible, so cells[0] IS the first offending cell.
    // Colon, not a dash: the cell reason carries its own "— do this" clause.
    return deny(
      sim,
      `no cell of the area ${spanLabel(data)} can be zoned: ` +
        zoneRejection(sim, cells[0].x, cells[0].y),
    );
  });

  world.registerHandler('zone', (data, w) => {
    for (const cell of rectCells(data)) {
      if (!zoneEligible(sim, cell.x, cell.y)) continue;
      const i = cellIndex(cell.x, cell.y);
      const entity = w.createEntity();
      w.setPosition(entity, { x: cell.x, y: cell.y });
      w.addComponent(entity, 'zoneCell', { zone: data.zone });
      sim.zoneEntities.set(i, entity);
    }
    refreshZones(sim);
    w.emit('zonesChanged', {});
  });

  world.registerValidator('dezone', (data) => {
    const offMap = anchorsRejection(data, 'dezoning area', 'corner');
    if (offMap) return deny(sim, offMap);
    // "Nothing is zoned here" and "it is all built on" need different fixes,
    // so the first built-on cell is remembered while scanning for a free one.
    let built: { cell: number; occupant: number } | null = null;
    for (const c of rectCells(data)) {
      const i = cellIndex(c.x, c.y);
      if (!sim.zoneCells.has(i)) continue;
      const occupant = sim.occupiedCells.get(i);
      if (occupant === undefined) return true;
      if (built === null) built = { cell: i, occupant };
    }
    if (built !== null) {
      return deny(
        sim,
        `every zoned cell in the area ${spanLabel(data)} is built on — ${cellLabel(built.cell)} ` +
          `holds ${occupantLabel(sim.world, built.occupant)}; bulldoze it before dezoning`,
      );
    }
    return deny(sim, `no cell of the area ${spanLabel(data)} is zoned — nothing to clear`);
  });

  world.registerHandler('dezone', (data, w) => {
    for (const cell of rectCells(data)) {
      const i = cellIndex(cell.x, cell.y);
      if (sim.occupiedCells.has(i)) continue;
      const entity = sim.zoneEntities.get(i);
      if (entity !== undefined) {
        w.destroyEntity(entity);
        sim.zoneEntities.delete(i);
      }
    }
    refreshZones(sim);
    w.emit('zonesChanged', {});
  });
}

/** Rebuilds the zone entity index (cell → entity) after snapshot load. */
export function refreshZoneEntities(sim: CitySim): void {
  const entities = new Map<number, number>();
  for (const id of sim.world.query('zoneCell', 'position')) {
    const position = sim.world.getComponent(id, 'position');
    if (position) entities.set(cellIndex(position.x, position.y), id);
  }
  sim.zoneEntities = entities;
}
