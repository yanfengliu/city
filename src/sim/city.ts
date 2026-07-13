import { World } from 'civ-engine';
import { BUDGET_INTERVAL_TICKS, GRID_HEIGHT, GRID_WIDTH, TPS } from './constants/map';
import { HIGHWAY_CELLS } from './constants/highway';
import { BUDGET_INTERVAL_OFFSET, STARTING_TREASURY } from './constants/economy';
import {
  DEFAULT_LAND_VALUE,
  DEFAULT_TAX_RATE,
  DEMAND_INTERVAL,
  DEMAND_INTERVAL_OFFSET,
  GROWTH_INTERVAL,
  GROWTH_INTERVAL_OFFSET,
  LEVEL_INTERVAL,
  LEVEL_INTERVAL_OFFSET,
  MOVE_IN_INTERVAL,
  MOVE_IN_INTERVAL_OFFSET,
} from './constants/zoning';
import { buildRoadGraph, type RoadGraph } from './road/road-graph';
import { generateTerrain, type TerrainData } from './terrain';
import { growthSystem, levelSystem, refreshOccupancy } from './buildings';
import { moveInSystem } from './citizens';
import { demandSystem } from './demand';
import { budgetSystem, registerEconomyCommands, taxDemandPenaltyOf, taxPenaltyOf } from './economy';
import { employmentSystem, unassignWorkers } from './employment';
import { tripSystem } from './traffic/trips';
import { vehicleSystem } from './traffic/vehicles';
import {
  congestionSystem,
  readCongestionMirror,
  refreshEdgeCounts,
} from './traffic/congestion';
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
  POWER_INTERVAL,
  POWER_INTERVAL_OFFSET,
  WATER_INTERVAL,
  WATER_INTERVAL_OFFSET,
} from './constants/utilities';
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
import {
  refreshRoads,
  registerBulldozeRect,
  registerRoadCommands,
  seedHighway,
} from './road/commands';
import { refreshStructures, registerServiceCommands } from './services';
import {
  powerSystem,
  refreshUtilities,
  registerUtilityCommands,
  waterSystem,
} from './utilities';
import { refreshZoneEntities, refreshZones, registerZoneCommands } from './zoning';
import type { CityWorld, ZoneType } from './types';

export interface CitySimConfig {
  seed: number;
  /** Phase 4 flips this: real pollution/noise/land-value/coverage inputs. */
  fieldsEnabled?: boolean;
  /** Phase 5 flips this: real power/water connectivity gates buildings. */
  utilitiesEnabled?: boolean;
  /** Seeds the fixed outside highway connection at the north edge (shipping on). */
  highwayEnabled?: boolean;
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
  /** Footprint cell → entity id: buildings, service structures, and plants/pumps (derived). */
  occupiedCells: Map<number, number>;
  /** Power line cell → entity id (derived; overhead lines never occupy). */
  powerLineCells: Map<number, number>;
  /** Pipe cell → entity id (derived; pipes are underground and never occupy). */
  pipeCells: Map<number, number>;
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
  refreshUtilities(sim); // after refreshStructures — adds plant/pump/line cells
  refreshEdgeCounts(sim);
  readCongestionMirror(sim);
  readFieldMirrors(sim);
}

function neutralScoreInputs(world: CityWorld): ScoreInputs {
  return {
    landValueAt: () => DEFAULT_LAND_VALUE,
    coverageCount: () => 0,
    powered: () => true,
    watered: () => true,
    educated: () => false,
    // Taxes apply regardless of fieldsEnabled/utilitiesEnabled.
    taxPenalty: (zone) => taxPenaltyOf(world, zone),
    taxDemandPenalty: (zone) => taxDemandPenaltyOf(world, zone),
  };
}

/**
 * Builds the city sim. Registration order below is a replay/save contract:
 * append new registrations at the end of their section, never reorder.
 */
export function createCitySim(config: CitySimConfig): CitySim {
  const terrain = generateTerrain(config.seed, GRID_WIDTH, GRID_HEIGHT);
  // The highway is a solid-ground gateway: clear any water/trees under its
  // footprint before fields bake terrain-derived state (done here, not later).
  if (config.highwayEnabled) {
    for (const i of HIGHWAY_CELLS) {
      terrain.water[i] = 0;
      terrain.trees[i] = 0;
      terrain.elevation[i] = terrain.seaLevel;
    }
  }
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
  world.registerComponent('powerPlant');
  world.registerComponent('powerLine');
  world.registerComponent('pipe');
  world.registerComponent('waterPump');

  // -- world state --
  world.setState('treasury', STARTING_TREASURY);
  world.setState('demand', { r: 0, c: 0, i: 0 });
  world.setState('population', 0);
  world.setState('disconnectedTrips', 0);
  world.setState('tripCursor', 0);
  world.setState('taxRates', { r: DEFAULT_TAX_RATE, c: DEFAULT_TAX_RATE, i: DEFAULT_TAX_RATE });

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
    powerLineCells: new Map(),
    pipeCells: new Map(),
    fields,
    scoreInputs: neutralScoreInputs(world),
    edgeCounts: new Map(),
    edgeBuckets: new Map(),
    pathVersion: 0,
    pathCache: new Map(),
    adjacencyCache: null,
  };
  // Phase 4: real field-driven desirability inputs replace the neutral seam.
  if (config.fieldsEnabled) sim.scoreInputs = fieldScoreInputs(sim);
  // Phase 5: powered/watered read the flags the flood-fill systems maintain.
  if (config.utilitiesEnabled) {
    sim.scoreInputs = {
      ...sim.scoreInputs,
      powered: (entity) => world.getComponent(entity, 'building')?.powered ?? true,
      watered: (entity) => world.getComponent(entity, 'building')?.watered ?? true,
    };
  }

  // -- world entities: the fixed outside highway connection --
  if (config.highwayEnabled) seedHighway(sim);

  // -- commands --
  registerRoadCommands(sim);
  registerZoneCommands(sim);
  registerBulldozeRect(sim);
  registerServiceCommands(sim);
  registerUtilityCommands(sim);
  registerEconomyCommands(sim);

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
  world.registerSystem({
    name: 'power',
    phase: 'update',
    execute: powerSystem(sim, config.utilitiesEnabled ?? false),
    interval: POWER_INTERVAL,
    intervalOffset: POWER_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'water',
    phase: 'update',
    execute: waterSystem(sim, config.utilitiesEnabled ?? false),
    interval: WATER_INTERVAL,
    intervalOffset: WATER_INTERVAL_OFFSET,
  });
  world.registerSystem({
    name: 'budget',
    phase: 'postUpdate',
    execute: budgetSystem(sim),
    interval: BUDGET_INTERVAL_TICKS,
    intervalOffset: BUDGET_INTERVAL_OFFSET,
  });

  world.endSetup();
  return sim;
}
