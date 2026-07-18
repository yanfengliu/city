import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import { SERVICE_FOOTPRINT } from './constants/services';
import {
  PIPE_COST_PER_CELL,
  POWER_LINE_COST_PER_CELL,
  POWER_PLANT_CAPACITY,
  POWER_PLANT_COST,
  POWER_PLANT_FOOTPRINT,
  UTILITY_BRIDGE_RADIUS,
  UTILITY_DEMAND_PER_CELL_LEVEL,
  WATER_PUMP_CAPACITY,
  WATER_PUMP_COST,
} from './constants/utilities';
import { footprintCells } from './buildings';
import { bulldozeGrowableBuildings } from './demolition';
import { cellFromIndex, cellIndex, inBounds } from './grid';
import {
  pathIndices,
  pipePlacementPlan,
  powerLinePlacementPlan,
  powerPlantPlacementPlan,
  waterPumpPlacementPlan,
} from './utility-placement';
import type { CitySim } from './city';
import type { CityWorld } from './types';

/** Local copy of city.ts getTreasury — avoids a runtime import cycle city ⇄ utilities. */
function treasury(w: CityWorld): number {
  return (w.getState('treasury') as number | undefined) ?? 0;
}

/**
 * Re-registers plant/turbine/pump footprints into sim.occupiedCells and rebuilds
 * the power-line/pipe cell caches. Lines and pipes are thin overlays (overhead
 * cabling / underground pipe) that never occupy — a building can grow under
 * either. Must run after refreshStructures in rebuildDerived.
 */
export function refreshUtilities(sim: CitySim): void {
  const w = sim.world;
  const lines = new Map<number, number>();
  const pipes = new Map<number, number>();
  for (const id of w.query('powerLine', 'position')) {
    const position = w.getComponent(id, 'position');
    if (!position) continue;
    lines.set(cellIndex(position.x, position.y), id);
  }
  for (const id of w.query('pipe', 'position')) {
    const position = w.getComponent(id, 'position');
    if (position) pipes.set(cellIndex(position.x, position.y), id);
  }
  for (const id of w.query('powerPlant', 'position')) {
    const plant = w.getComponent(id, 'powerPlant');
    const position = w.getComponent(id, 'position');
    if (!plant || !position) continue;
    const side = POWER_PLANT_FOOTPRINT[plant.kind];
    for (const cell of footprintCells(position.x, position.y, side, side)) {
      sim.occupiedCells.set(cell, id);
    }
  }
  for (const id of w.query('waterPump', 'position')) {
    const position = w.getComponent(id, 'position');
    if (position) sim.occupiedCells.set(cellIndex(position.x, position.y), id);
  }
  sim.powerLineCells = lines;
  sim.pipeCells = pipes;
}

export function registerUtilityCommands(sim: CitySim): void {
  const { world } = sim;

  world.registerValidator('placePowerPlant', (data) =>
    powerPlantPlacementPlan(sim, world, data) !== null,
  );

  world.registerHandler('placePowerPlant', (data, w) => {
    const plan = powerPlantPlacementPlan(sim, w, data);
    if (!plan) return;
    const entity = w.createEntity();
    w.setPosition(entity, { x: data.x, y: data.y });
    w.addComponent(entity, 'powerPlant', { kind: data.kind });
    bulldozeGrowableBuildings(sim, w, plan.buildingIds);
    w.setState('treasury', treasury(w) - POWER_PLANT_COST[data.kind]);
    for (const cell of plan.cells) sim.occupiedCells.set(cell, entity);
    w.emit('utilitiesChanged', {});
  });

  world.registerValidator('placeWaterPump', (data) =>
    waterPumpPlacementPlan(sim, world, data) !== null,
  );

  world.registerHandler('placeWaterPump', (data, w) => {
    const plan = waterPumpPlacementPlan(sim, w, data);
    if (!plan) return;
    const entity = w.createEntity();
    w.setPosition(entity, { x: data.x, y: data.y });
    w.addComponent(entity, 'waterPump', {});
    bulldozeGrowableBuildings(sim, w, plan.buildingIds);
    w.setState('treasury', treasury(w) - WATER_PUMP_COST);
    sim.occupiedCells.set(plan.cells[0], entity);
    w.emit('utilitiesChanged', {});
  });

  world.registerValidator(
    'placePowerLine',
    (data) => powerLinePlacementPlan(sim, world, data) !== null,
  );

  world.registerHandler('placePowerLine', (data, w) => {
    const newCells = pathIndices(data).filter((i) => !sim.powerLineCells.has(i));
    for (const i of newCells) {
      const entity = w.createEntity();
      w.setPosition(entity, cellFromIndex(i));
      w.addComponent(entity, 'powerLine', {});
      // Overlay only: the line conducts via powerLineCells and never touches
      // occupiedCells or the zone map, so a building can grow under the wire.
      sim.powerLineCells.set(i, entity);
    }
    w.setState('treasury', treasury(w) - newCells.length * POWER_LINE_COST_PER_CELL);
    w.emit('utilitiesChanged', {});
  });

  world.registerValidator('placePipe', (data) => pipePlacementPlan(sim, world, data) !== null);

  world.registerHandler('placePipe', (data, w) => {
    const newCells = pathIndices(data).filter((i) => !sim.pipeCells.has(i));
    for (const i of newCells) {
      const entity = w.createEntity();
      w.setPosition(entity, cellFromIndex(i));
      w.addComponent(entity, 'pipe', {});
      sim.pipeCells.set(i, entity);
    }
    w.setState('treasury', treasury(w) - newCells.length * PIPE_COST_PER_CELL);
    w.emit('utilitiesChanged', {});
  });
}

/**
 * Destroys utility entities (plants, turbines, pumps, lines, pipes) whose
 * cells intersect the given cells. No refunds. Called by the bulldozeRect
 * handler after structures and before the building pass.
 */
export function bulldozeUtilities(sim: CitySim, w: CityWorld, cells: number[]): void {
  const doomed = new Set<number>();
  for (const i of cells) {
    const occupant = sim.occupiedCells.get(i);
    if (
      occupant !== undefined &&
      (w.getComponent(occupant, 'powerPlant') !== undefined ||
        w.getComponent(occupant, 'waterPump') !== undefined)
    ) {
      doomed.add(occupant);
    }
    // Lines live only in powerLineCells (they never occupy), so find them there.
    const line = sim.powerLineCells.get(i);
    if (line !== undefined) doomed.add(line);
    const pipe = sim.pipeCells.get(i);
    if (pipe !== undefined) doomed.add(pipe);
  }
  if (doomed.size === 0) return;

  for (const id of [...doomed].sort((p, q) => p - q)) {
    const position = w.getComponent(id, 'position');
    const plant = w.getComponent(id, 'powerPlant');
    if (position) {
      const i = cellIndex(position.x, position.y);
      if (plant) {
        const side = POWER_PLANT_FOOTPRINT[plant.kind];
        for (const cell of footprintCells(position.x, position.y, side, side)) {
          sim.occupiedCells.delete(cell);
        }
      } else if (w.getComponent(id, 'powerLine')) {
        // Overlay only — the line never owned occupiedCells; just drop it.
        sim.powerLineCells.delete(i);
      } else if (w.getComponent(id, 'pipe')) {
        sim.pipeCells.delete(i);
      } else if (w.getComponent(id, 'waterPump')) {
        sim.occupiedCells.delete(i);
      }
    }
    w.destroyEntity(id);
  }
  w.emit('utilitiesChanged', {});
}

/** A capacity source (plant or pump) already resolved to its footprint cells. */
interface SourceGroup {
  cells: number[];
  capacity: number;
}

interface FootprintEntry {
  entity: number;
  cells: number[];
  demand: number;
}

/**
 * Shared connectivity + allocation for both utility networks.
 *
 * Network cells = source footprints + conductor cells, connected by 4-dir
 * adjacency (same-cell overlap unions too — pipes sit under pumps/buildings).
 * Building and structure footprints join a network when any footprint cell is
 * within Chebyshev UTILITY_BRIDGE_RADIUS of a network cell; non-abandoned
 * buildings and structures then conduct (their cells join the network), so
 * membership is found by repeated passes until a fixpoint — deterministic
 * because every list is sorted by entity id. Abandoned buildings never conduct
 * but are membership-tested at the end so they can recover.
 *
 * Allocation: per network, buildings draw capacity in ascending entity-id
 * order; the first building that does not fit exhausts the network (strict
 * prefix semantics — deterministic brownout). Structures consume nothing.
 * Returns supplied/unsupplied for EVERY building entity.
 */
function computeUtilityAssignments(
  w: CityWorld,
  sources: SourceGroup[],
  conductorCells: number[],
): Map<number, boolean> {
  // Union-find with min-root union: component roots are order-independent.
  const parent: number[] = [];
  const makeNode = (): number => {
    const id = parent.length;
    parent.push(id);
    return id;
  };
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };

  const cellNet = new Map<number, number>();
  const claimCell = (cell: number, node: number): void => {
    const existing = cellNet.get(cell);
    if (existing !== undefined) union(existing, node);
    else cellNet.set(cell, node);
  };

  const sourceNodes: number[] = [];
  for (const source of sources) {
    const node = makeNode();
    sourceNodes.push(node);
    for (const cell of source.cells) claimCell(cell, node);
  }
  for (const cell of conductorCells) claimCell(cell, makeNode());

  // 4-dir adjacency between network cells (checking +x/+y covers all pairs).
  for (const cell of [...cellNet.keys()].sort((a, b) => a - b)) {
    const x = cell % GRID_WIDTH;
    const y = Math.floor(cell / GRID_WIDTH);
    const node = cellNet.get(cell);
    if (node === undefined) continue;
    if (x + 1 < GRID_WIDTH) {
      const right = cellNet.get(cell + 1);
      if (right !== undefined) union(node, right);
    }
    if (y + 1 < GRID_HEIGHT) {
      const down = cellNet.get(cell + GRID_WIDTH);
      if (down !== undefined) union(node, down);
    }
  }

  /** Distinct network nodes within the bridge radius of any footprint cell, in scan order. */
  const hitNodes = (cells: number[]): number[] => {
    const hits: number[] = [];
    const seen = new Set<number>();
    for (const cell of cells) {
      const x = cell % GRID_WIDTH;
      const y = Math.floor(cell / GRID_WIDTH);
      for (let dy = -UTILITY_BRIDGE_RADIUS; dy <= UTILITY_BRIDGE_RADIUS; dy++) {
        for (let dx = -UTILITY_BRIDGE_RADIUS; dx <= UTILITY_BRIDGE_RADIUS; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny, GRID_WIDTH, GRID_HEIGHT)) continue;
          const node = cellNet.get(cellIndex(nx, ny));
          if (node !== undefined && !seen.has(node)) {
            seen.add(node);
            hits.push(node);
          }
        }
      }
    }
    return hits;
  };

  // Conductors (bridge AND extend the network) vs membership-only buildings.
  const conductors: FootprintEntry[] = [];
  const membershipOnly: FootprintEntry[] = [];
  const allBuildings: FootprintEntry[] = [];
  for (const id of [...w.query('building', 'position')].sort((a, b) => a - b)) {
    const building = w.getComponent(id, 'building');
    const position = w.getComponent(id, 'position');
    if (!building || !position) continue;
    const entry: FootprintEntry = {
      entity: id,
      cells: footprintCells(position.x, position.y, building.w, building.h),
      demand: UTILITY_DEMAND_PER_CELL_LEVEL * building.level * building.w * building.h,
    };
    allBuildings.push(entry);
    // Buildings conduct regardless of their own supplied state (no brownout
    // cascades), but abandoned buildings do not conduct.
    if (building.abandoned) membershipOnly.push(entry);
    else conductors.push(entry);
  }
  for (const id of [...w.query('structure', 'position')].sort((a, b) => a - b)) {
    const structure = w.getComponent(id, 'structure');
    const position = w.getComponent(id, 'position');
    if (!structure || !position) continue;
    // Structures conduct and always function; they consume 0 in v1.
    conductors.push({
      entity: id,
      cells: footprintCells(position.x, position.y, SERVICE_FOOTPRINT, SERVICE_FOOTPRINT),
      demand: 0,
    });
  }

  const attached = new Map<number, number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of conductors) {
      if (attached.has(entry.entity)) continue;
      const hits = hitNodes(entry.cells);
      if (hits.length === 0) continue;
      const node = makeNode();
      for (const hit of hits) union(node, hit);
      for (const cell of entry.cells) claimCell(cell, node);
      attached.set(entry.entity, node);
      changed = true;
    }
  }
  for (const entry of membershipOnly) {
    const hits = hitNodes(entry.cells);
    if (hits.length > 0) attached.set(entry.entity, hits[0]);
  }

  const remaining = new Map<number, number>();
  sources.forEach((source, index) => {
    const root = find(sourceNodes[index]);
    remaining.set(root, (remaining.get(root) ?? 0) + source.capacity);
  });

  const supplied = new Map<number, boolean>();
  const exhausted = new Set<number>();
  for (const entry of allBuildings) {
    const node = attached.get(entry.entity);
    if (node === undefined) {
      supplied.set(entry.entity, false);
      continue;
    }
    const root = find(node);
    const budget = remaining.get(root) ?? 0;
    if (!exhausted.has(root) && budget >= entry.demand) {
      remaining.set(root, budget - entry.demand);
      supplied.set(entry.entity, true);
    } else {
      exhausted.add(root);
      supplied.set(entry.entity, false);
    }
  }
  return supplied;
}

/** Patches building components only where the flag actually changed. */
function applyFlags(
  w: CityWorld,
  supplied: Map<number, boolean>,
  flag: 'powered' | 'watered',
): void {
  for (const [entity, value] of supplied) {
    const building = w.getComponent(entity, 'building');
    if (!building || building[flag] === value) continue;
    w.patchComponent(entity, 'building', (b) => {
      b[flag] = value;
    });
  }
}

/**
 * Power flood-fill (interval 8, offset 7). Registered even when utilities are
 * disabled (replay contract) but then never writes.
 */
export function powerSystem(sim: CitySim, enabled: boolean): (w: CityWorld) => void {
  return (w) => {
    if (!enabled) return;
    const sources: SourceGroup[] = [];
    for (const id of [...w.query('powerPlant', 'position')].sort((a, b) => a - b)) {
      const plant = w.getComponent(id, 'powerPlant');
      const position = w.getComponent(id, 'position');
      if (!plant || !position) continue;
      const side = POWER_PLANT_FOOTPRINT[plant.kind];
      sources.push({
        cells: footprintCells(position.x, position.y, side, side),
        capacity: POWER_PLANT_CAPACITY[plant.kind],
      });
    }
    const conductors = [...sim.powerLineCells.keys()].sort((a, b) => a - b);
    applyFlags(w, computeUtilityAssignments(w, sources, conductors), 'powered');
  };
}

/** Capacity vs. load for one utility network. */
export interface UtilityTotals {
  /** Installed capacity — sum of plant/pump capacities. */
  supply: number;
  /** Total draw — level x footprint over EVERY building (abandoned too, so the
   * signal never reads 0 the instant a city goes dark and needs it most). */
  demand: number;
}

/**
 * City-wide power/water capacity vs. load, for the HUD's "add a plant" vs.
 * "connect it up" signal. Pure read over entities (no flood-fill, no mutation),
 * so it never affects conduction or determinism. Power and water share the same
 * per-building demand formula, so demand is identical across the two.
 */
export function utilityTotals(world: CityWorld): { power: UtilityTotals; water: UtilityTotals } {
  let demand = 0;
  for (const id of world.query('building')) {
    const b = world.getComponent(id, 'building');
    if (b) demand += UTILITY_DEMAND_PER_CELL_LEVEL * b.level * b.w * b.h;
  }
  let powerSupply = 0;
  for (const id of world.query('powerPlant')) {
    const plant = world.getComponent(id, 'powerPlant');
    if (plant) powerSupply += POWER_PLANT_CAPACITY[plant.kind];
  }
  let waterSupply = 0;
  for (const id of world.query('waterPump')) {
    if (world.getComponent(id, 'waterPump')) waterSupply += WATER_PUMP_CAPACITY;
  }
  return {
    power: { supply: powerSupply, demand },
    water: { supply: waterSupply, demand },
  };
}

/** Water flood-fill (interval 8, offset 1) — same shape as power. */
export function waterSystem(sim: CitySim, enabled: boolean): (w: CityWorld) => void {
  return (w) => {
    if (!enabled) return;
    const sources: SourceGroup[] = [];
    for (const id of [...w.query('waterPump', 'position')].sort((a, b) => a - b)) {
      const position = w.getComponent(id, 'position');
      if (!position) continue;
      sources.push({
        cells: [cellIndex(position.x, position.y)],
        capacity: WATER_PUMP_CAPACITY,
      });
    }
    const conductors = [...sim.pipeCells.keys()].sort((a, b) => a - b);
    applyFlags(w, computeUtilityAssignments(w, sources, conductors), 'watered');
  };
}
