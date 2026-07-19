import { footprintCells } from '../sim/buildings';
import { SERVICE_FOOTPRINT } from '../sim/constants/services';
import { POWER_PLANT_FOOTPRINT } from '../sim/constants/utilities';
import { UTILITY_ABANDON_EVALS } from '../sim/constants/zoning';
import { cellIndex } from '../sim/grid';
import type { CitySim } from '../sim/city';
import type {
  BuildingView,
  PowerNetworkView,
  RoadEdgePayload,
  StructureView,
  WaterNetworkView,
} from '../protocol/messages';
import type { BuildingComponent, CityWorld, ZoneType } from '../sim/types';

/**
 * Pure world → protocol projections. Separated from `sim.worker.ts` so the
 * message loop there is lifecycle only (speed, advance, command dispatch,
 * recorder/harness) and these stay unit-testable without a Worker.
 *
 * They return payloads rather than taking a `post` callback, matching
 * `pedestrian-projection.ts` and `diff-projection.ts`: the caller owns *when*
 * to send and any dirty-flag gating, these own only *what* is sent. Every
 * entity sweep sorts by id, because message order is part of the determinism
 * contract the recorded-session gate replays.
 */

/** One building's render view, or null when it has no position yet. */
export function projectBuildingView(
  world: CityWorld,
  id: number,
  data: BuildingComponent,
): BuildingView | null {
  const position = world.getComponent(id, 'position');
  if (!position) return null;
  return {
    id,
    generation: world.getEntityGeneration(id),
    x: position.x,
    y: position.y,
    w: data.w,
    h: data.h,
    kind: 'rci',
    zone: data.zone,
    level: data.level,
    abandoned: data.abandoned,
    residents: data.residents,
    jobsFilled: data.jobsFilled,
    powered: data.powered,
    watered: data.watered,
    // Normalised so the renderer needs no sim constants to tell a building
    // that just lost power from one about to be abandoned over it.
    utilityDistress: Math.min(1, data.badUtilityEvals / UTILITY_ABANDON_EVALS),
  };
}

/** Every live building, in ascending entity order. */
export function projectBuildings(world: CityWorld): BuildingView[] {
  const buildings: BuildingView[] = [];
  for (const id of [...world.query('building')].sort((a, b) => a - b)) {
    const data = world.getComponent(id, 'building');
    if (!data) continue;
    const view = projectBuildingView(world, id, data);
    if (view) buildings.push(view);
  }
  return buildings;
}

/** Every player-placed service structure, in ascending entity order. */
export function projectStructures(world: CityWorld): StructureView[] {
  const structures: StructureView[] = [];
  for (const id of [...world.query('structure', 'position')].sort((a, b) => a - b)) {
    const data = world.getComponent(id, 'structure');
    const position = world.getComponent(id, 'position');
    if (!data || !position) continue;
    structures.push({
      id,
      generation: world.getEntityGeneration(id),
      x: position.x,
      y: position.y,
      w: SERVICE_FOOTPRINT,
      h: SERVICE_FOOTPRINT,
      kind: 'service',
      service: data.type,
    });
  }
  return structures;
}

/** The full zoned-cell set, sorted by cell index. */
export function projectZoneCells(sim: CitySim): Array<{ i: number; zone: ZoneType }> {
  return [...sim.zoneCells.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, zone]) => ({ i, zone }));
}

/** Road cells plus the graph edges, for the topology-versioned `roads` message. */
export function projectRoads(sim: CitySim): { cells: number[]; edges: RoadEdgePayload[] } {
  return {
    cells: [...sim.roadCells].sort((a, b) => a - b),
    edges: sim.roadGraph.edges.map((e) => ({ id: e.id, a: e.a, b: e.b, cells: e.cells })),
  };
}

/** Full utility-network geometry: plant/pump footprints plus line/pipe cells. */
export function projectNetworks(
  sim: CitySim,
  world: CityWorld,
): { power: PowerNetworkView; water: WaterNetworkView } {
  const plantCells: number[] = [];
  const plants: PowerNetworkView['plants'] = [];
  for (const id of [...world.query('powerPlant', 'position')].sort((a, b) => a - b)) {
    const plant = world.getComponent(id, 'powerPlant');
    const position = world.getComponent(id, 'position');
    if (!plant || !position) continue;
    const side = POWER_PLANT_FOOTPRINT[plant.kind];
    const cells = footprintCells(position.x, position.y, side, side);
    plantCells.push(...cells);
    plants.push({ kind: plant.kind, x: position.x, y: position.y, w: side, h: side, cells });
  }
  const pumpCells: number[] = [];
  for (const id of [...world.query('waterPump', 'position')].sort((a, b) => a - b)) {
    const position = world.getComponent(id, 'position');
    if (position) pumpCells.push(cellIndex(position.x, position.y));
  }
  return {
    power: {
      plants,
      plantCells,
      lineCells: [...sim.powerLineCells.keys()].sort((a, b) => a - b),
    },
    water: {
      pumpCells,
      pipeCells: [...sim.pipeCells.keys()].sort((a, b) => a - b),
    },
  };
}
