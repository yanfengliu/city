import { GRID_HEIGHT, GRID_WIDTH } from '../constants/map';
import { HIGHWAY_CELLS, HIGHWAY_CELL_SET } from '../constants/highway';
import {
  BRIDGE_COST_PER_CELL,
  ROAD_BULLDOZE_REFUND,
  ROAD_COST_PER_CELL,
} from '../constants/economy';
import { bulldozeGrowableBuildings } from '../demolition';
import { purchaseAllowed } from '../economy';
import { cellIndex, lPathCells } from '../grid';
import {
  anchorsRejection,
  cellLabel,
  deny,
  occupantLabel,
  refuse,
  spanLabel,
} from '../rejection';
import { bulldozeStructures } from '../services';
import { writeCongestionMirror } from '../traffic/congestion';
import { captureEdgeKeys, edgeKey, remapVehiclesAfterTopologyChange } from '../traffic/topology';
import { bulldozeUtilities } from '../utilities';
import { dezoneCells, rectCells } from '../zoning';
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

/** Shared by both bulldoze validators when the selection is all highway. */
function highwayOnlyReason(where: string): string {
  return (
    `${where} covers only the outside highway connection, which is permanent — ` +
    'the city may never be cut off from the outside world'
  );
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
  if (newCells.length === 0) {
    return refuse(
      sim,
      `every cell of the path from ${spanLabel(data)} is already road — nothing to build`,
    );
  }
  for (const c of newCells) {
    const i = cellIndex(c.x, c.y);
    // Water is buildable as a bridge (at a premium). Power lines are thin
    // overlays that never own a cell, so roads cross them freely; any real
    // occupant (building, service, plant, pump) blocks.
    const occupant = sim.occupiedCells.get(i);
    if (occupant !== undefined) {
      return refuse(
        sim,
        `${cellLabel(i)} is occupied by ${occupantLabel(sim.world, occupant)} — ` +
          'bulldoze it before paving',
      );
    }
  }
  const cost = roadCellsCost(sim, newCells);
  if (!purchaseAllowed(sim.world, cost, false)) {
    return refuse(
      sim,
      `${newCells.length} new road cell${newCells.length === 1 ? '' : 's'} cost $${cost} ` +
        `but the treasury holds $${Math.floor(treasury(sim.world))}`,
    );
  }
  return { cells: newCells, cost };
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
    const offMap = anchorsRejection(data, 'road', 'endpoint');
    if (offMap) return deny(sim, offMap);
    return placeableRoadCells(sim, data) !== null;
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
    const offMap = anchorsRejection(data, 'road', 'endpoint');
    if (offMap) return deny(sim, offMap);
    const cells = roadPath(data).map((c) => cellIndex(c.x, c.y));
    // Highway cells are road but never removable, so a path of only highway
    // used to be accepted and then quietly remove nothing. Refuse it instead
    // and say why — the handler's removed > 0 guard already made it a no-op.
    if (cells.some((i) => sim.roadCells.has(i) && !HIGHWAY_CELL_SET.has(i))) return true;
    if (cells.some((i) => sim.roadCells.has(i))) {
      return deny(sim, highwayOnlyReason(`the path from ${spanLabel(data)}`));
    }
    return deny(
      sim,
      `no cell of the path from ${spanLabel(data)} is a road — nothing to bulldoze`,
    );
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
    const offMap = anchorsRejection(data, 'bulldoze area', 'corner');
    if (offMap) return deny(sim, offMap);
    let sawHighway = false;
    for (const c of rectCells(data)) {
      const i = cellIndex(c.x, c.y);
      if (sim.occupiedCells.has(i) || sim.powerLineCells.has(i) || sim.pipeCells.has(i)) {
        return true;
      }
      if (!sim.roadCells.has(i)) continue;
      // See the bulldozeRoad validator: highway-only used to be a silent no-op.
      if (HIGHWAY_CELL_SET.has(i)) sawHighway = true;
      else return true;
    }
    if (sawHighway) return deny(sim, highwayOnlyReason(`the area ${spanLabel(data)}`));
    return deny(
      sim,
      `nothing to bulldoze in the area ${spanLabel(data)} — it holds no road, building, ` +
        'service, power line, or pipe',
    );
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
