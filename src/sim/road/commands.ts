import { GRID_HEIGHT, GRID_WIDTH } from '../constants/map';
import {
  ROAD_BULLDOZE_REFUND,
  ROAD_COST_PER_CELL,
} from '../constants/economy';
import { evictCitizens, footprintCells } from '../buildings';
import { purchaseAllowed } from '../economy';
import { unassignWorkers } from '../employment';
import { cellIndex, inBounds, lPathCells } from '../grid';
import { bulldozeStructures } from '../services';
import { writeCongestionMirror } from '../traffic/congestion';
import { captureEdgeKeys, edgeKey, remapVehiclesAfterTopologyChange } from '../traffic/topology';
import { bulldozeUtilities } from '../utilities';
import { dezoneCells, rectCells, validRect } from '../zoning';
import { buildRoadGraph } from './road-graph';
import type { CitySim } from '../city';
import type { CityWorld, RoadEndpoints } from '../types';

/** Local copy of city.ts getTreasury — avoids a runtime import cycle city ⇄ road commands. */
function treasury(w: CityWorld): number {
  return (w.getState('treasury') as number | undefined) ?? 0;
}

function roadPath(data: RoadEndpoints) {
  return lPathCells({ x: data.ax, y: data.ay }, { x: data.bx, y: data.by });
}

function validEndpoints(data: RoadEndpoints): boolean {
  return (
    inBounds(data.ax, data.ay, GRID_WIDTH, GRID_HEIGHT) &&
    inBounds(data.bx, data.by, GRID_WIDTH, GRID_HEIGHT)
  );
}

/**
 * Recomputes road cell set and graph, bumps topology + path versions, clears
 * the path cache. When called from a command handler (in-tick), pass the
 * world so in-flight vehicles are remapped onto the new edge ids (vehicles on
 * vanished edges despawn as disconnected trips).
 */
export function refreshRoads(sim: CitySim, w?: CityWorld): void {
  const oldKeys = captureEdgeKeys(sim.roadGraph);
  const cells = new Set<number>();
  for (const id of sim.world.query('roadCell', 'position')) {
    const position = sim.world.getComponent(id, 'position');
    if (position) cells.add(cellIndex(position.x, position.y));
  }
  sim.roadCells = cells;
  sim.roadGraph = buildRoadGraph(cells, GRID_WIDTH, GRID_HEIGHT);
  sim.topologyVersion += 1;
  sim.pathVersion += 1;
  sim.pathCache.clear();
  sim.adjacencyCache = null;
  if (w) {
    remapVehiclesAfterTopologyChange(sim, w, oldKeys);
    // Bucket keys are edge ids — carry them across the rebuild by geometry.
    const newIdsByKey = new Map<string, number>();
    for (const edge of sim.roadGraph.edges) newIdsByKey.set(edgeKey(edge), edge.id);
    const remapped = new Map<number, number>();
    for (const [oldId, bucket] of sim.edgeBuckets) {
      const key = oldKeys.get(oldId);
      const newId = key !== undefined ? newIdsByKey.get(key) : undefined;
      if (newId !== undefined) remapped.set(newId, bucket);
    }
    sim.edgeBuckets = remapped;
    writeCongestionMirror(sim, w);
  }
}

export function registerRoadCommands(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('placeRoad', (data) => {
    if (!validEndpoints(data)) return false;
    const path = roadPath(data);
    const newCells = path.filter((c) => !sim.roadCells.has(cellIndex(c.x, c.y)));
    if (newCells.length === 0) return false;
    for (const c of newCells) {
      const i = cellIndex(c.x, c.y);
      if (sim.terrain.water[i] === 1 || sim.occupiedCells.has(i)) return false;
    }
    return purchaseAllowed(world, newCells.length * ROAD_COST_PER_CELL, false);
  });

  world.registerHandler('placeRoad', (data, w) => {
    const path = roadPath(data);
    const newCells = path.filter((c) => !sim.roadCells.has(cellIndex(c.x, c.y)));
    for (const cell of newCells) {
      const entity = w.createEntity();
      w.setPosition(entity, { x: cell.x, y: cell.y });
      w.addComponent(entity, 'roadCell', {});
    }
    w.setState('treasury', treasury(w) - newCells.length * ROAD_COST_PER_CELL);
    dezoneCells(
      sim,
      w,
      newCells.map((c) => cellIndex(c.x, c.y)),
    );
    refreshRoads(sim, w);
    w.emit('roadsChanged', {});
  });

  world.registerValidator('bulldozeRoad', (data) => {
    if (!validEndpoints(data)) return false;
    return roadPath(data).some((c) => sim.roadCells.has(cellIndex(c.x, c.y)));
  });

  world.registerHandler('bulldozeRoad', (data, w) => {
    removeRoadCells(
      sim,
      w,
      roadPath(data).map((c) => cellIndex(c.x, c.y)),
    );
    refreshRoads(sim, w);
    w.emit('roadsChanged', {});
  });
}

/** Destroys road entities on the given cells and refunds part of their cost. */
function removeRoadCells(sim: CitySim, w: CityWorld, cells: number[]): number {
  let removed = 0;
  for (const i of cells) {
    if (!sim.roadCells.has(i)) continue;
    const x = i % GRID_WIDTH;
    const y = Math.floor(i / GRID_WIDTH);
    const occupants = w.grid.getAt(x, y);
    if (!occupants) continue;
    for (const id of [...occupants].sort((p, q) => p - q)) {
      if (w.getComponent(id, 'roadCell')) {
        w.destroyEntity(id);
        removed++;
      }
    }
    // A power line crossing this road survives the bulldoze; the freed cell
    // becomes line-owned again (matches what refreshUtilities rebuilds on
    // load — keeps live and restored derived state identical).
    const line = sim.powerLineCells.get(i);
    if (line !== undefined) sim.occupiedCells.set(i, line);
  }
  if (removed > 0) {
    w.setState(
      'treasury',
      treasury(w) + Math.floor(removed * ROAD_COST_PER_CELL * ROAD_BULLDOZE_REFUND),
    );
  }
  return removed;
}

export function registerBulldozeRect(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('bulldozeRect', (data) => {
    if (!validRect(data)) return false;
    return rectCells(data).some((c) => {
      const i = cellIndex(c.x, c.y);
      return sim.roadCells.has(i) || sim.occupiedCells.has(i) || sim.pipeCells.has(i);
    });
  });

  world.registerHandler('bulldozeRect', (data, w) => {
    const cells = rectCells(data).map((c) => cellIndex(c.x, c.y));

    // Service structures first — frees their occupiedCells entries so the
    // building pass below only sees actual buildings.
    bulldozeStructures(sim, w, cells);
    // Utilities next, for the same reason (plants/pumps/lines also occupy).
    bulldozeUtilities(sim, w, cells);

    // Buildings whose footprint intersects the rect.
    const buildings = new Set<number>();
    for (const i of cells) {
      const id = sim.occupiedCells.get(i);
      if (id !== undefined) buildings.add(id);
    }
    for (const id of [...buildings].sort((p, q) => p - q)) {
      const building = w.getComponent(id, 'building');
      const position = w.getComponent(id, 'position');
      evictCitizens(w, id);
      unassignWorkers(w, id);
      if (building && position) {
        for (const cell of footprintCells(position.x, position.y, building.w, building.h)) {
          sim.occupiedCells.delete(cell);
        }
      }
      w.destroyEntity(id);
    }

    const roadRemoved = removeRoadCells(sim, w, cells);
    if (roadRemoved > 0) {
      refreshRoads(sim, w);
      w.emit('roadsChanged', {});
    }
  });
}
