import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import {
  COVERAGE_BLOCK_SIZE,
  SERVICE_COST,
  SERVICE_FOOTPRINT,
  SERVICE_LABELS,
  SERVICE_RADIUS,
  SERVICE_TYPES,
} from './constants/services';
import { footprintCells } from './buildings';
import { bulldozeGrowableBuildings, scanFootprint } from './demolition';
import { purchaseAllowed } from './economy';
import { coverageMirrorState } from './fields';
import { cellIndex, inBounds } from './grid';
import { refuse } from './rejection';
import type { Layer } from 'civ-engine';
import type { CitySim } from './city';
import type {
  CityWorld,
  CoverageFieldName,
  PlaceServiceCommand,
  ServiceType,
} from './types';

/** Local copy of city.ts getTreasury — avoids a runtime import cycle city ⇄ services. */
function treasury(w: CityWorld): number {
  return (w.getState('treasury') as number | undefined) ?? 0;
}

/**
 * Marks every coverage block containing at least one cell within the service
 * radius (Chebyshev) of the anchor cell — see SERVICE_RADIUS for the metric
 * contract.
 */
function markCoverage(layer: Layer<number>, x: number, y: number, radius: number): void {
  const bx0 = Math.max(0, Math.floor((x - radius) / COVERAGE_BLOCK_SIZE));
  const bx1 = Math.min(layer.width - 1, Math.floor((x + radius) / COVERAGE_BLOCK_SIZE));
  const by0 = Math.max(0, Math.floor((y - radius) / COVERAGE_BLOCK_SIZE));
  const by1 = Math.min(layer.height - 1, Math.floor((y + radius) / COVERAGE_BLOCK_SIZE));
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) layer.setCell(bx, by, 1);
  }
}

/** Service → the overlay field name its coverage layer is published under. */
const COVERAGE_FIELD_OF: Record<ServiceType, CoverageFieldName> = {
  fireStation: 'fireCoverage',
  police: 'policeCoverage',
  clinic: 'healthCoverage',
  school: 'educationCoverage',
  park: 'parkCoverage',
  garden: 'gardenCoverage',
};

/**
 * Recomputes one service's coverage layer from its structure entities, then
 * announces it so a subscribed coverage overlay repaints. Coverage is rebuilt
 * on structure changes rather than on a tick cadence, so this is the only
 * place the change can be observed.
 */
export function rebuildCoverage(sim: CitySim, service: ServiceType): void {
  const layer = sim.fields.coverage[service];
  layer.fill(0);
  for (const id of sim.world.query('structure', 'position')) {
    const structure = sim.world.getComponent(id, 'structure');
    const position = sim.world.getComponent(id, 'position');
    if (!structure || !position || structure.type !== service) continue;
    markCoverage(layer, position.x, position.y, SERVICE_RADIUS[service]);
  }
  sim.world.emit('fieldChanged', { field: COVERAGE_FIELD_OF[service] });
}

/** Persists every coverage layer — written only when structures change. */
export function writeCoverageMirror(sim: CitySim, w: CityWorld): void {
  const mirror = w.getState('mirrorEntity') as number;
  w.setComponent(mirror, 'coverageMirror', coverageMirrorState(sim.fields));
}

/**
 * Re-registers service footprints into sim.occupiedCells. Must run after
 * refreshOccupancy, which replaces the map with building footprints only.
 */
export function refreshStructures(sim: CitySim): void {
  for (const id of sim.world.query('structure', 'position')) {
    const position = sim.world.getComponent(id, 'position');
    if (!position) continue;
    for (const cell of footprintCells(position.x, position.y, SERVICE_FOOTPRINT, SERVICE_FOOTPRINT)) {
      sim.occupiedCells.set(cell, id);
    }
  }
}

/** Any footprint cell 4-adjacent to a road cell. */
function touchesRoad(sim: CitySim, cells: number[]): boolean {
  for (const i of cells) {
    const x = i % GRID_WIDTH;
    const y = Math.floor(i / GRID_WIDTH);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (inBounds(nx, ny, GRID_WIDTH, GRID_HEIGHT) && sim.roadCells.has(cellIndex(nx, ny))) {
        return true;
      }
    }
  }
  return false;
}

interface ServicePlacementPlan {
  cells: number[];
  buildingIds: number[];
}

function servicePlacementPlan(
  sim: CitySim,
  w: CityWorld,
  data: PlaceServiceCommand,
): ServicePlacementPlan | null {
  if (!SERVICE_TYPES.includes(data.service)) {
    return refuse(
      sim,
      `unknown service "${data.service}" — expected one of ${SERVICE_TYPES.join(', ')}`,
    );
  }
  const max = SERVICE_FOOTPRINT - 1;
  if (
    !inBounds(data.x, data.y, GRID_WIDTH, GRID_HEIGHT) ||
    !inBounds(data.x + max, data.y + max, GRID_WIDTH, GRID_HEIGHT)
  ) {
    return refuse(
      sim,
      `a ${SERVICE_FOOTPRINT}x${SERVICE_FOOTPRINT} service anchored at (${data.x}, ${data.y}) ` +
        `falls outside the ${GRID_WIDTH}x${GRID_HEIGHT} map`,
    );
  }
  const cells = footprintCells(data.x, data.y, SERVICE_FOOTPRINT, SERVICE_FOOTPRINT);
  const scan = scanFootprint(sim, w, cells);
  if (!scan.ok) return refuse(sim, scan.reason);
  if (!touchesRoad(sim, cells)) {
    return refuse(
      sim,
      `no cell of the footprint at (${data.x}, ${data.y}) touches a road — ` +
        'services must sit beside one',
    );
  }
  const cost = SERVICE_COST[data.service];
  if (!purchaseAllowed(w, cost, false)) {
    return refuse(
      sim,
      `${SERVICE_LABELS[data.service]} costs $${cost} but the treasury holds ` +
        `$${Math.floor(treasury(w))}`,
    );
  }
  return { cells, buildingIds: scan.buildingIds };
}

export function registerServiceCommands(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('placeService', (data) => servicePlacementPlan(sim, world, data) !== null);

  world.registerHandler('placeService', (data, w) => {
    // Commands validate when queued; re-plan against execution-time occupancy
    // and funds so competing same-tick stamps cannot overlap or double-charge.
    const plan = servicePlacementPlan(sim, w, data);
    if (!plan) return;
    // Allocate before demolition because civ-engine can immediately recycle a
    // destroyed id, while the worker projects removals by component identity.
    const entity = w.createEntity();
    w.setPosition(entity, { x: data.x, y: data.y });
    w.addComponent(entity, 'structure', { type: data.service });
    bulldozeGrowableBuildings(sim, w, plan.buildingIds);
    w.setState('treasury', treasury(w) - SERVICE_COST[data.service]);
    for (const cell of plan.cells) sim.occupiedCells.set(cell, entity);
    rebuildCoverage(sim, data.service);
    writeCoverageMirror(sim, w);
    w.emit('structuresChanged', {});
  });
}

/**
 * Destroys service structures whose footprint intersects the given cells and
 * rebuilds the affected coverage layers. Called by the bulldozeRect handler
 * BEFORE its building pass so structures never reach the building path.
 */
export function bulldozeStructures(sim: CitySim, w: CityWorld, cells: number[]): void {
  const structures = new Set<number>();
  for (const i of cells) {
    const id = sim.occupiedCells.get(i);
    if (id !== undefined && w.getComponent(id, 'structure')) structures.add(id);
  }
  if (structures.size === 0) return;

  const services = new Set<ServiceType>();
  for (const id of [...structures].sort((p, q) => p - q)) {
    const structure = w.getComponent(id, 'structure');
    const position = w.getComponent(id, 'position');
    if (structure && position) {
      services.add(structure.type);
      for (const cell of footprintCells(position.x, position.y, SERVICE_FOOTPRINT, SERVICE_FOOTPRINT)) {
        sim.occupiedCells.delete(cell);
      }
    }
    w.destroyEntity(id);
  }
  for (const service of SERVICE_TYPES) {
    if (services.has(service)) rebuildCoverage(sim, service);
  }
  writeCoverageMirror(sim, w);
  w.emit('structuresChanged', {});
}
