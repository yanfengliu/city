import { World } from 'civ-engine';
import { GRID_HEIGHT, GRID_WIDTH, TPS } from './constants/map';
import {
  ROAD_BULLDOZE_REFUND,
  ROAD_COST_PER_CELL,
  STARTING_TREASURY,
} from './constants/economy';
import {
  DEFAULT_LAND_VALUE,
  DEMAND_INTERVAL,
  DEMAND_INTERVAL_OFFSET,
  GROWTH_INTERVAL,
  GROWTH_INTERVAL_OFFSET,
  LEVEL_INTERVAL,
  LEVEL_INTERVAL_OFFSET,
  MOVE_IN_INTERVAL,
  MOVE_IN_INTERVAL_OFFSET,
} from './constants/zoning';
import { cellIndex, inBounds, lPathCells } from './grid';
import { buildRoadGraph, type RoadGraph } from './road/road-graph';
import { generateTerrain, type TerrainData } from './terrain';
import {
  evictCitizens,
  footprintCells,
  growthSystem,
  levelSystem,
  refreshOccupancy,
} from './buildings';
import { moveInSystem } from './citizens';
import { demandSystem } from './demand';
import { employmentSystem, unassignWorkers } from './employment';
import { tripSystem } from './traffic/trips';
import { vehicleSystem } from './traffic/vehicles';
import {
  congestionSystem,
  readCongestionMirror,
  refreshEdgeCounts,
  writeCongestionMirror,
} from './traffic/congestion';
import { captureEdgeKeys, edgeKey, remapVehiclesAfterTopologyChange } from './traffic/topology';
import {
  CONGESTION_INTERVAL,
  CONGESTION_INTERVAL_OFFSET,
  EMPLOYMENT_INTERVAL,
  EMPLOYMENT_INTERVAL_OFFSET,
  TRIP_INTERVAL,
  TRIP_INTERVAL_OFFSET,
} from './constants/traffic';
import {
  LAND_VALUE_INTERVAL,
  LAND_VALUE_INTERVAL_OFFSET,
  NOISE_INTERVAL,
  NOISE_INTERVAL_OFFSET,
  POLLUTION_INTERVAL,
  POLLUTION_INTERVAL_OFFSET,
} from './constants/fields';
import {
  coverageMirrorState,
  createCityFields,
  fieldScoreInputs,
  landValueSystem,
  noiseSystem,
  pollutionSystem,
  readFieldMirrors,
  type CityFields,
} from './fields';
import { bulldozeStructures, refreshStructures, registerServiceCommands } from './services';
import {
  rectCells,
  refreshZoneEntities,
  refreshZones,
  registerZoneCommands,
  validRect,
} from './zoning';
import type { CityWorld, RoadEndpoints, ZoneType } from './types';

export interface CitySimConfig {
  seed: number;
  /** Phase 4 flips this: real pollution/noise/land-value/coverage inputs. */
  fieldsEnabled?: boolean;
  /** Phase 5 flips this: real power/water connectivity gates buildings. */
  utilitiesEnabled?: boolean;
}

/** Pluggable desirability/demand inputs — later phases replace the neutral defaults. */
export interface ScoreInputs {
  landValueAt(x: number, y: number): number;
  coverageCount(x: number, y: number): number;
  powered(entity: number): boolean;
  watered(entity: number): boolean;
  educated(x: number, y: number): boolean;
  /** Desirability penalty from taxes for a zone (0 at default rate). */
  taxPenalty(zone: ZoneType): number;
  /** Demand penalty from taxes for a zone (0 at default rate). */
  taxDemandPenalty(zone: ZoneType): number;
}

/**
 * The World plus game-owned derived caches. Everything outside `world` is
 * recomputable from world state — `rebuildDerived` is the single choke point
 * that must restore it after snapshot load.
 */
export interface CitySim {
  readonly world: CityWorld;
  readonly seed: number;
  readonly terrain: TerrainData;
  roadCells: Set<number>;
  roadGraph: RoadGraph;
  topologyVersion: number;
  /** Zoned cell → zone type (derived from zoneCell entities). */
  zoneCells: Map<number, ZoneType>;
  /** Zoned cell → zoneCell entity id (derived). */
  zoneEntities: Map<number, number>;
  /** Footprint cell → entity id, buildings AND service structures (derived). */
  occupiedCells: Map<number, number>;
  /** Field layers + static terrain masks; layer states persist via mirror components. */
  fields: CityFields;
  scoreInputs: ScoreInputs;
  /** Vehicles currently on each edge (derived from vehicle components). */
  edgeCounts: Map<number, number>;
  /** Congestion bucket (1..3) per edge; absent = 0 (derived). */
  edgeBuckets: Map<number, number>;
  /** Bumps on topology change or congestion requantization; keys path caching. */
  pathVersion: number;
  pathCache: Map<string, { version: number; nodes: number[] | null }>;
  adjacencyCache: { version: number; map: Map<number, AdjacencyList> } | null;
}

type AdjacencyList = Array<{ to: number; edge: number; cost: number }>;

export function getTreasury(world: CityWorld): number {
  return (world.getState('treasury') as number | undefined) ?? 0;
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

/** Restores every derived cache from world state. Call after applySnapshot. */
export function rebuildDerived(sim: CitySim): void {
  // Deterministic rebuild produces identical edge ids for an identical cell
  // set, so no vehicle remap is needed here (and none would be legal outside
  // a tick).
  refreshRoads(sim);
  refreshZones(sim);
  refreshZoneEntities(sim);
  refreshOccupancy(sim);
  refreshStructures(sim); // after refreshOccupancy — it replaces occupiedCells
  refreshEdgeCounts(sim);
  readCongestionMirror(sim);
  readFieldMirrors(sim);
}

function dezoneCellsUnderRoad(sim: CitySim, w: CityWorld, cells: number[]): void {
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

function registerRoadCommands(sim: CitySim): void {
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
    return getTreasury(world) >= newCells.length * ROAD_COST_PER_CELL;
  });

  world.registerHandler('placeRoad', (data, w) => {
    const path = roadPath(data);
    const newCells = path.filter((c) => !sim.roadCells.has(cellIndex(c.x, c.y)));
    for (const cell of newCells) {
      const entity = w.createEntity();
      w.setPosition(entity, { x: cell.x, y: cell.y });
      w.addComponent(entity, 'roadCell', {});
    }
    w.setState('treasury', getTreasury(w) - newCells.length * ROAD_COST_PER_CELL);
    dezoneCellsUnderRoad(
      sim,
      w,
      newCells.map((c) => cellIndex(c.x, c.y)),
    );
    refreshRoads(sim);
    w.emit('roadsChanged', { topologyVersion: sim.topologyVersion });
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
    refreshRoads(sim);
    w.emit('roadsChanged', { topologyVersion: sim.topologyVersion });
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
  }
  if (removed > 0) {
    w.setState(
      'treasury',
      getTreasury(w) + Math.floor(removed * ROAD_COST_PER_CELL * ROAD_BULLDOZE_REFUND),
    );
  }
  return removed;
}

function registerBulldozeRect(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('bulldozeRect', (data) => {
    if (!validRect(data)) return false;
    return rectCells(data).some((c) => {
      const i = cellIndex(c.x, c.y);
      return sim.roadCells.has(i) || sim.occupiedCells.has(i);
    });
  });

  world.registerHandler('bulldozeRect', (data, w) => {
    const cells = rectCells(data).map((c) => cellIndex(c.x, c.y));

    // Service structures first — frees their occupiedCells entries so the
    // building pass below only sees actual buildings.
    bulldozeStructures(sim, w, cells);

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
      refreshRoads(sim);
      w.emit('roadsChanged', { topologyVersion: sim.topologyVersion });
    }
  });
}

function neutralScoreInputs(config: CitySimConfig): ScoreInputs {
  void config; // phases 4/5 branch on the flags to supply real inputs
  return {
    landValueAt: () => DEFAULT_LAND_VALUE,
    coverageCount: () => 0,
    powered: () => true,
    watered: () => true,
    educated: () => false,
    taxPenalty: () => 0,
    taxDemandPenalty: () => 0,
  };
}

/**
 * Builds the city sim. Registration order below is a replay/save contract:
 * append new registrations at the end of their section, never reorder.
 */
export function createCitySim(config: CitySimConfig): CitySim {
  const terrain = generateTerrain(config.seed, GRID_WIDTH, GRID_HEIGHT);
  const world = new World({
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    tps: TPS,
    seed: config.seed,
  }) as CityWorld;

  // -- components --
  world.registerComponent('position');
  world.registerComponent('roadCell');
  world.registerComponent('zoneCell');
  world.registerComponent('building');
  world.registerComponent('citizen');
  world.registerComponent('vehicle');
  world.registerComponent('congestionMirror');
  world.registerComponent('structure');
  world.registerComponent('pollutionMirror');
  world.registerComponent('noiseMirror');
  world.registerComponent('landValueMirror');
  world.registerComponent('coverageMirror');

  // -- world state --
  world.setState('treasury', STARTING_TREASURY);
  world.setState('demand', { r: 0, c: 0, i: 0 });
  world.setState('population', 0);
  world.setState('disconnectedTrips', 0);
  world.setState('tripCursor', 0);

  // Singleton mirror entity (see CityComponents.congestionMirror).
  const fields = createCityFields(terrain);
  const mirror = world.createEntity();
  world.addComponent(mirror, 'congestionMirror', { buckets: [] });
  world.addComponent(mirror, 'pollutionMirror', fields.pollution.getState());
  world.addComponent(mirror, 'noiseMirror', fields.noise.getState());
  world.addComponent(mirror, 'landValueMirror', fields.landValue.getState());
  world.addComponent(mirror, 'coverageMirror', coverageMirrorState(fields));
  world.setState('mirrorEntity', mirror);

  const sim: CitySim = {
    world,
    seed: config.seed,
    terrain,
    roadCells: new Set(),
    roadGraph: buildRoadGraph(new Set(), GRID_WIDTH, GRID_HEIGHT),
    topologyVersion: 0,
    zoneCells: new Map(),
    zoneEntities: new Map(),
    occupiedCells: new Map(),
    fields,
    scoreInputs: neutralScoreInputs(config),
    edgeCounts: new Map(),
    edgeBuckets: new Map(),
    pathVersion: 0,
    pathCache: new Map(),
    adjacencyCache: null,
  };
  // Phase 4: real field-driven desirability inputs replace the neutral seam.
  if (config.fieldsEnabled) sim.scoreInputs = fieldScoreInputs(sim);

  // -- commands --
  registerRoadCommands(sim);
  registerZoneCommands(sim);
  registerBulldozeRect(sim);
  registerServiceCommands(sim);

  // Abandoned workplaces shed their workers (listener avoids an import cycle
  // between buildings.ts and employment.ts; runs synchronously at emit).
  world.on('buildingAbandoned', ({ entity }) => unassignWorkers(world, entity));

  // -- systems --
  world.registerSystem({
    name: 'growth',
    phase: 'update',
    execute: growthSystem(sim),
    interval: GROWTH_INTERVAL,
    intervalOffset: GROWTH_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'moveIn',
    phase: 'update',
    execute: moveInSystem(sim),
    interval: MOVE_IN_INTERVAL,
    intervalOffset: MOVE_IN_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'level',
    phase: 'postUpdate',
    execute: levelSystem(sim),
    interval: LEVEL_INTERVAL,
    intervalOffset: LEVEL_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'demand',
    phase: 'postUpdate',
    execute: demandSystem(sim),
    interval: DEMAND_INTERVAL,
    intervalOffset: DEMAND_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'employment',
    phase: 'update',
    execute: employmentSystem(sim),
    interval: EMPLOYMENT_INTERVAL,
    intervalOffset: EMPLOYMENT_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'trips',
    phase: 'update',
    execute: tripSystem(sim),
    interval: TRIP_INTERVAL,
    intervalOffset: TRIP_INTERVAL_OFFSET,
  });
  world.registerSystem({ name: 'vehicles', phase: 'update', execute: vehicleSystem(sim) });
  world.registerSystem({
    name: 'congestion',
    phase: 'postUpdate',
    execute: congestionSystem(sim),
    interval: CONGESTION_INTERVAL,
    intervalOffset: CONGESTION_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'pollution',
    phase: 'postUpdate',
    execute: pollutionSystem(sim),
    interval: POLLUTION_INTERVAL,
    intervalOffset: POLLUTION_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'noise',
    phase: 'postUpdate',
    execute: noiseSystem(sim),
    interval: NOISE_INTERVAL,
    intervalOffset: NOISE_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'landValue',
    phase: 'postUpdate',
    execute: landValueSystem(sim),
    interval: LAND_VALUE_INTERVAL,
    intervalOffset: LAND_VALUE_INTERVAL_OFFSET,
  });

  world.endSetup();
  return sim;
}
