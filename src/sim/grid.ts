import { GRID_WIDTH } from './constants/map';

export interface Cell {
  x: number;
  y: number;
}

export function cellIndex(x: number, y: number, width = GRID_WIDTH): number {
  return y * width + x;
}

export function cellFromIndex(index: number, width = GRID_WIDTH): Cell {
  return { x: index % width, y: Math.floor(index / width) };
}

export function inBounds(x: number, y: number, width: number, height: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
}

/**
 * Cells of an L-shaped path from a to b, dominant axis first, endpoints
 * inclusive. Shared by sim command handlers and the client ghost preview so
 * both always agree on the affected cells.
 */
export function lPathCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const horizontalFirst = Math.abs(dx) >= Math.abs(dy);

  let { x, y } = a;
  cells.push({ x, y });
  if (horizontalFirst) {
    while (x !== b.x) {
      x += stepX;
      cells.push({ x, y });
    }
    while (y !== b.y) {
      y += stepY;
      cells.push({ x, y });
    }
  } else {
    while (y !== b.y) {
      y += stepY;
      cells.push({ x, y });
    }
    while (x !== b.x) {
      x += stepX;
      cells.push({ x, y });
    }
  }
  return cells;
}
