import { GRID_HEIGHT, GRID_WIDTH } from '../constants/map';
import { HIGHWAY_CELLS, HIGHWAY_CELL_SET } from '../constants/highway';
import {
  BRIDGE_COST_PER_CELL,
  ROAD_BULLDOZE_REFUND,
  ROAD_COST_PER_CELL,
} from '../constants/economy';
import { bulldozeGrowableBuildings } from '../demolition';
import { purchaseAllowed } from '../economy';
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

/** Per-cell road cost: water cells build as bridges at the premium rate. */
export function roadCellCost(sim: CitySim, i: number): number {
  return sim.terrain.water[i] === 1 ? BRIDGE_COST_PER_CELL : ROAD_COST_PER_CELL;
}

function roadCellsCost(sim: CitySim, cells: Array<{ x: number; y: number }>): number {
  let total = 0;
  for (const c of cells) total += roadCellCost(sim, cellIndex(c.x, c.y));
  return total;
}

/**
 * Shared placeRoad gate, evaluated at validation AND again at execution:
 * commands validate at submit time but run at the tick drain, so a same-tick
 * command (e.g. a bulldoze freeing cells on this path) can change the new-cell
 * set and its cost in between. Re-gating in the handler keeps the "validators
 * reject any purchase the treasury cannot cover" invariant — the handler
 * no-ops instead of overdrafting or paving occupied cells.
 */
function placeableRoadCells(
  sim: CitySim,
  data: RoadEndpoints,
): { cells: Array<{ x: number; y: number }>; cost: number } | null {
  const newCells = roadPath(data).filter((c) => !sim.roadCells.has(cellIndex(c.x, c.y)));
  if (newCells.length === 0) return null;
  for (const c of newCells) {
    const i = cellIndex(c.x, c.y);
    // Water is buildable as a bridge (at a premium). Power lines are thin
    // overlays that never own a cell, so roads cross them freely; any real
    // occupant (building, service, plant, pump) blocks.
    if (sim.occupiedCells.has(i)) return null;
  }
  const cost = roadCellsCost(sim, newCells);
  if (!purchaseAllowed(sim.world, cost, false)) return null;
  return { cells: newCells, cost };
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
  sim.pedestrianPathCache.clear();
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
    return validEndpoints(data) && placeableRoadCells(sim, data) !== null;
  });

  world.registerHandler('placeRoad', (data, w) => {
    // Re-gate at execution — see placeableRoadCells. No-op if a same-tick
    // command made the placement unpayable or blocked.
    const placement = placeableRoadCells(sim, data);
    if (!placement) return;
    for (const cell of placement.cells) {
      const entity = w.createEntity();
      w.setPosition(entity, { x: cell.x, y: cell.y });
      w.addComponent(entity, 'roadCell', {});
      // A power line under the new road is an overlay — it survives untouched
      // and keeps conducting; there is no occupancy to transfer.
    }
    w.setState('treasury', treasury(w) - placement.cost);
    dezoneCells(
      sim,
      w,
      placement.cells.map((c) => cellIndex(c.x, c.y)),
    );
    refreshRoads(sim, w);
    w.emit('roadsChanged', {});
  });

  world.registerValidator('bulldozeRoad', (data) => {
    if (!validEndpoints(data)) return false;
    return roadPath(data).some((c) => sim.roadCells.has(cellIndex(c.x, c.y)));
  });

  world.registerHandler('bulldozeRoad', (data, w) => {
    const removed = removeRoadCells(
      sim,
      w,
      roadPath(data).map((c) => cellIndex(c.x, c.y)),
    );
    // A path of only protected highway cells removes nothing — skip the
    // rebuild (matches bulldozeRect's guard).
    if (removed > 0) {
      refreshRoads(sim, w);
      w.emit('roadsChanged', {});
    }
  });
}

/**
 * Seeds the fixed outside highway as road cells at construction. Deterministic
 * (identical entity order every build) and part of the serialized world — it
 * comes back from the snapshot on load, and `rebuildDerived` re-includes it.
 */
export function seedHighway(sim: CitySim): void {
  const { world } = sim;
  for (const i of HIGHWAY_CELLS) {
    const entity = world.createEntity();
    world.setPosition(entity, { x: i % GRID_WIDTH, y: Math.floor(i / GRID_WIDTH) });
    world.addComponent(entity, 'roadCell', {});
  }
  refreshRoads(sim);
}

/** Destroys road entities on the given cells and refunds part of their cost. */
function removeRoadCells(sim: CitySim, w: CityWorld, cells: number[]): number {
  let removed = 0;
  let refundBase = 0;
  for (const i of cells) {
    if (!sim.roadCells.has(i)) continue;
    // The outside highway connection is permanent — never bulldozable.
    if (HIGHWAY_CELL_SET.has(i)) continue;
    const x = i % GRID_WIDTH;
    const y = Math.floor(i / GRID_WIDTH);
    const occupants = w.grid.getAt(x, y);
    if (!occupants) continue;
    for (const id of [...occupants].sort((p, q) => p - q)) {
      if (w.getComponent(id, 'roadCell')) {
        w.destroyEntity(id);
        removed++;
        refundBase += roadCellCost(sim, i);
      }
    }
    // A power line crossing this road is an overlay — it survives untouched
    // and never owned the cell, so there is nothing to re-own.
  }
  if (removed > 0) {
    w.setState('treasury', treasury(w) + Math.floor(refundBase * ROAD_BULLDOZE_REFUND));
  }
  return removed;
}

export function registerBulldozeRect(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('bulldozeRect', (data) => {
    if (!validRect(data)) return false;
    return rectCells(data).some((c) => {
      const i = cellIndex(c.x, c.y);
      return (
        sim.roadCells.has(i) ||
        sim.occupiedCells.has(i) ||
        sim.powerLineCells.has(i) ||
        sim.pipeCells.has(i)
      );
    });
  });

  world.registerHandler('bulldozeRect', (data, w) => {
    const cells = rectCells(data).map((c) => cellIndex(c.x, c.y));

    // Service structures first — frees their occupiedCells entries so the
    // building pass below only sees actual buildings.
    bulldozeStructures(sim, w, cells);
    // Utilities next, for the same reason for plant/pump footprints; the same
    // pass also removes any non-occupying lines and pipes inside the rectangle.
    bulldozeUtilities(sim, w, cells);

    // Buildings whose footprint intersects the rect.
    const buildings = new Set<number>();
    for (const i of cells) {
      const id = sim.occupiedCells.get(i);
      if (id !== undefined) buildings.add(id);
    }
    bulldozeGrowableBuildings(sim, w, buildings);

    const roadRemoved = removeRoadCells(sim, w, cells);
    if (roadRemoved > 0) {
      refreshRoads(sim, w);
      w.emit('roadsChanged', {});
    }
  });
}
