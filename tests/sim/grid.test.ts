import { describe, expect, it } from 'vitest';
import { lPathCells } from '../../src/sim/grid';

describe('lPathCells', () => {
  it('returns the single cell when endpoints match', () => {
    expect(lPathCells({ x: 3, y: 4 }, { x: 3, y: 4 })).toEqual([{ x: 3, y: 4 }]);
  });

  it('walks the dominant axis first (horizontal)', () => {
    const cells = lPathCells({ x: 0, y: 0 }, { x: 3, y: 1 });
    expect(cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
    ]);
  });

  it('walks the dominant axis first (vertical)', () => {
    const cells = lPathCells({ x: 0, y: 0 }, { x: 1, y: 3 });
    expect(cells[1]).toEqual({ x: 0, y: 1 });
    expect(cells.at(-1)).toEqual({ x: 1, y: 3 });
    expect(cells).toHaveLength(5);
  });

  it('handles negative directions', () => {
    const cells = lPathCells({ x: 5, y: 5 }, { x: 2, y: 5 });
    expect(cells).toEqual([
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
    ]);
  });
});
