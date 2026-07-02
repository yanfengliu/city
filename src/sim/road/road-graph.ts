/**
 * Derives the routing graph from the set of road cells. Game-owned and fully
 * derived: rebuild after any road change or snapshot load. Nodes are road
 * cells whose neighbor count ≠ 2 or whose two neighbors are non-collinear
 * (corners); edges are maximal straight runs between nodes. A connected
 * component with no natural node (a pure loop) gets its lowest-index cell
 * promoted to a node so it stays routable.
 */

export interface RoadEdge {
  id: number;
  /** Node cell indices at each end (equal for self-loops). */
  a: number;
  b: number;
  /** Path cell indices from a to b, endpoints inclusive. */
  cells: number[];
  /** Traversal length in cell steps (cells.length - 1, min 1). */
  length: number;
}

export interface RoadGraph {
  /** Node cell index → edge ids incident to it. */
  nodes: Map<number, number[]>;
  edges: RoadEdge[];
  /** Interior (non-node) road cell index → the edge it belongs to. */
  cellToEdge: Map<number, number>;
  /** Road cell index → connected-component id (deterministic flood order). */
  cellComponent: Map<number, number>;
}

// Direction order is part of determinism: E, S, W, N.
const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
] as const;

function opposite(direction: number): number {
  return (direction + 2) % 4;
}

export function buildRoadGraph(
  roadCells: ReadonlySet<number>,
  width: number,
  height: number,
): RoadGraph {
  const neighborDirs = new Map<number, number[]>();
  for (const cell of roadCells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    const dirs: number[] = [];
    for (let d = 0; d < DIRECTIONS.length; d++) {
      const nx = x + DIRECTIONS[d].dx;
      const ny = y + DIRECTIONS[d].dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (roadCells.has(ny * width + nx)) dirs.push(d);
    }
    neighborDirs.set(cell, dirs);
  }

  const isNode = (cell: number): boolean => {
    const dirs = neighborDirs.get(cell) as number[];
    if (dirs.length !== 2) return true;
    return opposite(dirs[0]) !== dirs[1]; // corner
  };

  const nodeSet = new Set<number>();
  for (const cell of roadCells) if (isNode(cell)) nodeSet.add(cell);

  // One flood per component: promote a node for node-less components (pure
  // loops) and record each cell's component id (used by route-based
  // employment to skip unreachable workplaces).
  const cellComponent = new Map<number, number>();
  let componentId = 0;
  const visited = new Set<number>();
  const sortedCells = [...roadCells].sort((p, q) => p - q);
  for (const start of sortedCells) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const stack = [start];
    visited.add(start);
    let hasNode = false;
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      component.push(cell);
      cellComponent.set(cell, componentId);
      if (nodeSet.has(cell)) hasNode = true;
      for (const d of neighborDirs.get(cell) as number[]) {
        const neighbor = cell + DIRECTIONS[d].dx + DIRECTIONS[d].dy * width;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    if (!hasNode) nodeSet.add(Math.min(...component));
    componentId++;
  }

  const nodes = new Map<number, number[]>();
  for (const node of [...nodeSet].sort((p, q) => p - q)) nodes.set(node, []);
  const edges: RoadEdge[] = [];
  const cellToEdge = new Map<number, number>();
  const walked = new Set<string>(); // `${nodeCell}:${direction}` walk starts already claimed

  for (const node of nodes.keys()) {
    for (let d = 0; d < DIRECTIONS.length; d++) {
      if (!(neighborDirs.get(node) as number[]).includes(d)) continue;
      if (walked.has(`${node}:${d}`)) continue;

      const cells = [node];
      let current = node;
      let direction = d;
      for (;;) {
        current = current + DIRECTIONS[direction].dx + DIRECTIONS[direction].dy * width;
        cells.push(current);
        if (nodeSet.has(current)) break;
        // Interior degree-2 cell: continue along the direction that isn't backwards.
        const dirs = neighborDirs.get(current) as number[];
        direction = dirs[0] === opposite(direction) ? dirs[1] : dirs[0];
      }

      walked.add(`${node}:${d}`);
      walked.add(`${current}:${opposite(direction)}`);
      const id = edges.length;
      edges.push({ id, a: node, b: current, cells, length: Math.max(1, cells.length - 1) });
      (nodes.get(node) as number[]).push(id);
      if (current !== node) (nodes.get(current) as number[]).push(id);
      for (const cell of cells) {
        if (!nodeSet.has(cell)) cellToEdge.set(cell, id);
      }
    }
  }

  return { nodes, edges, cellToEdge, cellComponent };
}
