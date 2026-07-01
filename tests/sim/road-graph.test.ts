import { describe, expect, it } from 'vitest';
import { buildRoadGraph } from '../../src/sim/road/road-graph';

const W = 16;
const H = 16;
const idx = (x: number, y: number) => y * W + x;

function graphOf(cells: Array<[number, number]>) {
  return buildRoadGraph(new Set(cells.map(([x, y]) => idx(x, y))), W, H);
}

describe('buildRoadGraph', () => {
  it('handles an empty set', () => {
    const g = graphOf([]);
    expect(g.nodes.size).toBe(0);
    expect(g.edges).toHaveLength(0);
  });

  it('a single cell is a node with no edges', () => {
    const g = graphOf([[3, 3]]);
    expect([...g.nodes.keys()]).toEqual([idx(3, 3)]);
    expect(g.edges).toHaveLength(0);
  });

  it('a straight run has two endpoint nodes and one edge', () => {
    const g = graphOf([
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    expect(g.nodes.size).toBe(2);
    expect(g.edges).toHaveLength(1);
    const edge = g.edges[0];
    expect(edge.a).toBe(idx(2, 5));
    expect(edge.b).toBe(idx(5, 5));
    expect(edge.length).toBe(3);
    expect(edge.cells).toHaveLength(4);
    // interior cells map to the edge
    expect(g.cellToEdge.get(idx(3, 5))).toBe(edge.id);
    expect(g.cellToEdge.get(idx(4, 5))).toBe(edge.id);
    expect(g.cellToEdge.has(idx(2, 5))).toBe(false);
  });

  it('an L-corner becomes a node joining two edges', () => {
    const g = graphOf([
      [2, 2],
      [3, 2],
      [4, 2],
      [4, 3],
      [4, 4],
    ]);
    expect(g.nodes.has(idx(4, 2))).toBe(true);
    expect(g.nodes.size).toBe(3);
    expect(g.edges).toHaveLength(2);
  });

  it('a T-intersection is a degree-3 node', () => {
    const g = graphOf([
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
      [6, 4],
      [4, 5],
      [4, 6],
    ]);
    expect(g.nodes.has(idx(4, 4))).toBe(true);
    expect(g.nodes.get(idx(4, 4))).toHaveLength(3);
    expect(g.edges).toHaveLength(3);
  });

  it('a pure loop gets a promoted node and closes on itself', () => {
    const g = graphOf([
      [2, 2],
      [3, 2],
      [4, 2],
      [4, 3],
      [4, 4],
      [3, 4],
      [2, 4],
      [2, 3],
    ]);
    // Loop of 8 cells, all degree 2... corners are nodes (non-collinear neighbors).
    // The four corners become nodes; four edges connect them.
    expect(g.nodes.size).toBe(4);
    expect(g.edges).toHaveLength(4);
  });

  it('a full circle with no corners promotes one node (single row loop impossible on grid, so use rectangle interior check)', () => {
    // Grid loops always have corners, so corner-nodes cover loops; this
    // documents that no component is left nodeless.
    const g = graphOf([
      [8, 8],
      [9, 8],
      [9, 9],
      [8, 9],
    ]);
    expect(g.nodes.size).toBeGreaterThan(0);
    expect(g.edges.length).toBeGreaterThan(0);
    // Every road cell is reachable: nodes + edge interiors cover the set.
    const covered = new Set<number>([...g.nodes.keys(), ...g.cellToEdge.keys()]);
    expect(covered.size).toBe(4);
  });

  it('disconnected components stay separate', () => {
    const g = graphOf([
      [1, 1],
      [2, 1],
      [3, 1],
      [10, 10],
      [11, 10],
      [12, 10],
    ]);
    expect(g.nodes.size).toBe(4);
    expect(g.edges).toHaveLength(2);
  });
});
