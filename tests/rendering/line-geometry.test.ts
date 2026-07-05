import { describe, expect, it } from 'vitest';
import { deriveLineGeometry } from '../../src/rendering/line-geometry';
import { POLE_SPACING } from '../../src/rendering/constants';

const GW = 100;
const at = (x: number, y: number): number => y * GW + x;

describe('deriveLineGeometry (sparse poles + spanning wires)', () => {
  it('strings a wire across every adjacency but poles only ends + every POLE_SPACING on a straight run', () => {
    // Horizontal run x=0..9 on row 1.
    const cells = Array.from({ length: 10 }, (_, x) => at(x, 1));
    const geom = deriveLineGeometry(cells, GW);

    // A wire spans each of the 9 gaps; none run vertically.
    expect(geom.eastSpans.length).toBe(9);
    expect(geom.southSpans.length).toBe(0);

    // Far fewer poles than cells — ends (x=0, x=9) plus one at x=6 (0 % SPACING).
    expect([...geom.poleCells].sort((a, b) => a - b)).toEqual([at(0, 1), at(POLE_SPACING, 1), at(9, 1)]);
    expect(geom.poleCells.length).toBeLessThan(cells.length);
  });

  it('places a pole at a corner and at line ends', () => {
    // L: (0,1)-(3,1) then (3,2)-(3,3).
    const cells = [at(0, 1), at(1, 1), at(2, 1), at(3, 1), at(3, 2), at(3, 3)];
    const geom = deriveLineGeometry(cells, GW);
    expect([...geom.poleCells].sort((a, b) => a - b)).toEqual([at(0, 1), at(3, 1), at(3, 3)]);
    expect([...geom.eastSpans].sort((a, b) => a - b)).toEqual([at(0, 1), at(1, 1), at(2, 1)]);
    expect([...geom.southSpans].sort((a, b) => a - b)).toEqual([at(3, 1), at(3, 2)]);
  });

  it('poles a junction (degree > 2)', () => {
    // Plus shape centered at (50,2).
    const cells = [at(50, 2), at(49, 2), at(51, 2), at(50, 1), at(50, 3)];
    const geom = deriveLineGeometry(cells, GW);
    expect(geom.poleCells).toContain(at(50, 2));
  });

  it('poles a lone cell with no spans', () => {
    const geom = deriveLineGeometry([at(50, 5)], GW);
    expect(geom.poleCells).toEqual([at(50, 5)]);
    expect(geom.eastSpans).toEqual([]);
    expect(geom.southSpans).toEqual([]);
  });

  it('does not wrap a wire across the grid edge (east of the last column)', () => {
    // Two cells: last column of row 1 and first column of row 2 — adjacent by
    // raw index (c, c+1) but NOT neighbors on the grid.
    const cells = [at(GW - 1, 1), at(0, 2)];
    const geom = deriveLineGeometry(cells, GW);
    expect(geom.eastSpans).toEqual([]); // no false horizontal span across the edge
  });
});
