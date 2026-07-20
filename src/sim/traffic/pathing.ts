import { findPath } from 'civ-engine';
import { GRID_HEIGHT, GRID_WIDTH } from '../constants/map';
import { SERVICE_FOOTPRINT } from '../constants/services';
import { EDGE_COST_BUCKET_FACTOR, PATH_MAX_ITERATIONS } from '../constants/traffic';
import { cellIndex, inBounds } from '../grid';
import { footprintCells } from '../buildings';
import type { CitySim } from '../city';
import type { VehicleLeg } from '../types';

interface AdjacencyEntry {
  to: number;
  edge: number;
  cost: number;
}

/** Node-graph adjacency with congestion-weighted costs, cached per pathVersion. */
function adjacency(sim: CitySim): Map<number, AdjacencyEntry[]> {
  if (sim.adjacencyCache && sim.adjacencyCache.version === sim.pathVersion) {
    return sim.adjacencyCache.map;
  }
  const map = new Map<number, AdjacencyEntry[]>();
  for (const [node, edgeIds] of sim.roadGraph.nodes) {
    const entries: AdjacencyEntry[] = [];
    for (const id of edgeIds) {
      const edge = sim.roadGraph.edges[id];
      const other = edge.a === node ? edge.b : edge.a;
      if (other === node) continue; // self-loops are useless for routing
      const bucket = sim.edgeBuckets.get(id) ?? 0;
      entries.push({
        to: other,
        edge: id,
        cost: edge.length * (1 + EDGE_COST_BUCKET_FACTOR * bucket),
      });
    }
    map.set(node, entries);
  }
  sim.adjacencyCache = { version: sim.pathVersion, map };
  return map;
}

/** First road cell 4-adjacent to a w x h footprint, in deterministic scan order. */
function footprintAccessCell(
  sim: CitySim,
  anchorX: number,
  anchorY: number,
  w: number,
  h: number,
): number | null {
  for (const cell of footprintCells(anchorX, anchorY, w, h)) {
    const x = cell % GRID_WIDTH;
    const y = Math.floor(cell / GRID_WIDTH);
    for (const [nx, ny] of [
      [x, y - 1],
      [x - 1, y],
      [x + 1, y],
      [x, y + 1],
    ]) {
      if (!inBounds(nx, ny, GRID_WIDTH, GRID_HEIGHT)) continue;
      const road = cellIndex(nx, ny);
      if (sim.roadCells.has(road)) return road;
    }
  }
  return null;
}

/** First road cell 4-adjacent to a building footprint, in deterministic scan order. */
export function buildingAccessCell(sim: CitySim, building: number): number | null {
  const data = sim.world.getComponent(building, 'building');
  const position = sim.world.getComponent(building, 'position');
  if (!data || !position) return null;
  return footprintAccessCell(sim, position.x, position.y, data.w, data.h);
}

/**
 * Where a walker enters or leaves anywhere a citizen can go: a grown building,
 * park, or community garden. Each must touch a road to exist, so a null answer
 * means the road that served it is gone.
 */
export function accessCell(sim: CitySim, entity: number): number | null {
  const building = buildingAccessCell(sim, entity);
  if (building !== null) return building;
  const position = sim.world.getComponent(entity, 'position');
  if (!position || !sim.world.getComponent(entity, 'structure')) return null;
  return footprintAccessCell(sim, position.x, position.y, SERVICE_FOOTPRINT, SERVICE_FOOTPRINT);
}

/**
 * Vehicle graph node for a building's exact access cell. Interior edge cells
 * resolve to an endpoint; pedestrians deliberately keep the exact cell.
 */
export function buildingAccessNode(sim: CitySim, building: number): number | null {
  const road = buildingAccessCell(sim, building);
  if (road === null) return null;
  if (sim.roadGraph.nodes.has(road)) return road;
  const edgeId = sim.roadGraph.cellToEdge.get(road);
  return edgeId === undefined ? null : sim.roadGraph.edges[edgeId].a;
}

function manhattan(a: number, b: number): number {
  const ax = a % GRID_WIDTH;
  const ay = Math.floor(a / GRID_WIDTH);
  const bx = b % GRID_WIDTH;
  const by = Math.floor(b / GRID_WIDTH);
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** Node path between two graph nodes, cached per (from, to) + pathVersion. */
export function findNodePath(sim: CitySim, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const key = `${from}:${to}`;
  const cached = sim.pathCache.get(key);
  if (cached && cached.version === sim.pathVersion) return cached.nodes;

  const adj = adjacency(sim);
  const result = findPath<number>({
    start: from,
    goal: to,
    neighbors: (node) => (adj.get(node) ?? []).map((e) => e.to),
    cost: (a, b) => {
      let best = Infinity;
      for (const entry of adj.get(a) ?? []) {
        if (entry.to === b && entry.cost < best) best = entry.cost;
      }
      return best;
    },
    heuristic: (node, goal) => manhattan(node, goal),
    hash: (node) => node,
    maxIterations: PATH_MAX_ITERATIONS,
  });

  const nodes = result ? result.path : null;
  sim.pathCache.set(key, { version: sim.pathVersion, nodes });
  return nodes;
}

const CELL_DIRECTIONS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

/**
 * Exact road-cell path between two walkable places (buildings or service
 * structures), cached only by topology version.
 */
export function findRoadCellPath(
  sim: CitySim,
  fromPlace: number,
  toPlace: number,
): number[] | null {
  const from = accessCell(sim, fromPlace);
  const to = accessCell(sim, toPlace);
  if (from === null || to === null) return null;
  if (from === to) return [from];
  const key = `${from}:${to}`;
  const cached = sim.pedestrianPathCache.get(key);
  if (cached?.version === sim.topologyVersion) return cached.cells;

  const result = findPath<number>({
    start: from,
    goal: to,
    neighbors: (cell) => {
      const x = cell % GRID_WIDTH;
      const y = Math.floor(cell / GRID_WIDTH);
      const out: number[] = [];
      for (const [dx, dy] of CELL_DIRECTIONS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny, GRID_WIDTH, GRID_HEIGHT)) continue;
        const next = cellIndex(nx, ny);
        if (sim.roadCells.has(next)) out.push(next);
      }
      return out;
    },
    cost: () => 1,
    heuristic: (cell, goal) => manhattan(cell, goal),
    hash: (cell) => cell,
    maxIterations: PATH_MAX_ITERATIONS,
  });
  const cells = result ? result.path : null;
  sim.pedestrianPathCache.set(key, { version: sim.topologyVersion, cells });
  return cells;
}

/** Converts a node path into edge legs (cheapest edge per hop, with direction). */
export function nodePathToLegs(sim: CitySim, nodes: number[]): VehicleLeg[] | null {
  const adj = adjacency(sim);
  const legs: VehicleLeg[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    let best: AdjacencyEntry | null = null;
    for (const entry of adj.get(nodes[i]) ?? []) {
      if (entry.to === nodes[i + 1] && (!best || entry.cost < best.cost)) best = entry;
    }
    if (!best) return null;
    const edge = sim.roadGraph.edges[best.edge];
    legs.push({ edge: best.edge, reverse: edge.a !== nodes[i] });
  }
  return legs;
}
