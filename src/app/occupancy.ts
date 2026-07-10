import { cellIndex } from '../sim/grid';

export interface FootprintView {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function sameFootprint(a: FootprintView, b: FootprintView): boolean {
  return a.id === b.id && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function visitFootprint(
  view: FootprintView,
  gridWidth: number,
  visit: (cell: number) => void,
): void {
  for (let dy = 0; dy < view.h; dy++) {
    for (let dx = 0; dx < view.w; dx++) {
      visit(cellIndex(view.x + dx, view.y + dy, gridWidth));
    }
  }
}

/**
 * Reconciles a cell-owner cache for an add, move/recycled-id upsert, or
 * removal. Returns whether downstream occupancy views became dirty.
 */
export function replaceFootprintOwner(
  owners: Map<number, number>,
  previous: FootprintView | undefined,
  next: FootprintView | null,
  gridWidth: number,
): boolean {
  if (previous && next && sameFootprint(previous, next)) return false;
  if (previous) {
    visitFootprint(previous, gridWidth, (cell) => {
      if (owners.get(cell) === previous.id) owners.delete(cell);
    });
  }
  if (next) visitFootprint(next, gridWidth, (cell) => owners.set(cell, next.id));
  return previous !== undefined || next !== null;
}

/** Plant/pump footprints occlude preserved zoning; non-occupying lines/pipes do not. */
export function collectZoneOcclusionCells(
  buildingOwners: ReadonlyMap<number, number>,
  structureOwners: ReadonlyMap<number, number>,
  utilityFootprintCells: ReadonlySet<number>,
): Set<number> {
  return new Set([
    ...buildingOwners.keys(),
    ...structureOwners.keys(),
    ...utilityFootprintCells,
  ]);
}
