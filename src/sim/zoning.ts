import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import { ZONE_MAX_ROAD_DISTANCE } from './constants/zoning';
import { cellIndex, inBounds } from './grid';
import type { CitySim } from './city';
import type { RectArea, ZoneType } from './types';

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

export function validRect(area: RectArea): boolean {
  return (
    inBounds(area.ax, area.ay, GRID_WIDTH, GRID_HEIGHT) &&
    inBounds(area.bx, area.by, GRID_WIDTH, GRID_HEIGHT)
  );
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
    nearRoad(sim, x, y)
  );
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

export function registerZoneCommands(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('zone', (data) => {
    if (!validRect(data)) return false;
    return rectCells(data).some((c) => zoneEligible(sim, c.x, c.y));
  });

  world.registerHandler('zone', (data, w) => {
    for (const cell of rectCells(data)) {
      if (!zoneEligible(sim, cell.x, cell.y)) continue;
      const i = cellIndex(cell.x, cell.y);
      const existing = sim.zoneEntities.get(i);
      if (existing !== undefined) {
        w.setComponent(existing, 'zoneCell', { zone: data.zone });
      } else {
        const entity = w.createEntity();
        w.setPosition(entity, { x: cell.x, y: cell.y });
        w.addComponent(entity, 'zoneCell', { zone: data.zone });
        sim.zoneEntities.set(i, entity);
      }
    }
    refreshZones(sim);
    w.emit('zonesChanged', {});
  });

  world.registerValidator('dezone', (data) => {
    if (!validRect(data)) return false;
    return rectCells(data).some((c) => {
      const i = cellIndex(c.x, c.y);
      return sim.zoneCells.has(i) && !sim.occupiedCells.has(i);
    });
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
