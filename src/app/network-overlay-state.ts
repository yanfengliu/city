import type { BuildingView, StructureView, WorkerToClient } from '../protocol/messages';
import type { NetworkOverlayData } from '../rendering/network-overlay';
import { utilityStatus } from '../rendering/overlay-semantics';
import { cellIndex } from '../sim/grid';

interface NetworkOverlayStateOptions {
  mode: 'power' | 'water';
  infrastructure: ReadonlySet<number>;
  buildings: Iterable<BuildingView>;
  structures: Iterable<StructureView>;
  gridWidth: number;
  gridHeight: number;
  radius: number;
}

interface RectFootprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

function footprintCells(view: RectFootprint, gridWidth: number): number[] {
  const cells: number[] = [];
  for (let dy = 0; dy < view.h; dy++) {
    for (let dx = 0; dx < view.w; dx++) {
      cells.push(cellIndex(view.x + dx, view.y + dy, gridWidth));
    }
  }
  return cells;
}

/**
 * Mirrors the sim's utility-conduction fixpoint for an honest player overlay.
 * Every attached live growable and service conducts, even during a brownout;
 * abandoned or disconnected growables do not extend the halo.
 */
export function computeNetworkOverlayState(
  options: NetworkOverlayStateOptions,
): NetworkOverlayData {
  const { mode, infrastructure, gridWidth, gridHeight, radius } = options;
  const supplied = new Set<number>();
  const warn = new Set<number>();
  const severe = new Set<number>();
  const conductorFootprints: number[][] = [];

  for (const view of options.buildings) {
    if (view.abandoned) continue;
    const cells = footprintCells(view, gridWidth);
    // One shared grading function, so overlay colour and the legend can never
    // drift from each other (rendering/overlay-semantics.ts).
    const bucket =
      { provided: supplied, warn, severe }[
        utilityStatus(mode, view) as 'provided' | 'warn' | 'severe'
      ] ?? supplied;
    for (const cell of cells) bucket.add(cell);
    conductorFootprints.push(cells);
  }
  for (const view of options.structures) {
    conductorFootprints.push(footprintCells(view, gridWidth));
  }

  const reach = new Set<number>();
  const expand = (cells: Iterable<number>): void => {
    for (const cell of cells) {
      const x = cell % gridWidth;
      const y = Math.floor(cell / gridWidth);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
          reach.add(cellIndex(nx, ny, gridWidth));
        }
      }
    }
  };
  expand(infrastructure);

  const pending = [...conductorFootprints];
  let attached = true;
  while (attached) {
    attached = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const cells = pending[i];
      if (!cells.some((cell) => reach.has(cell))) continue;
      expand(cells);
      pending.splice(i, 1);
      attached = true;
    }
  }

  return { infrastructure, reach, supplied, warn, severe };
}

/** Worker messages whose payload changes a client-computed utility overlay. */
export function networkOverlayInputsChanged(type: WorkerToClient['type']): boolean {
  return type === 'buildings' || type === 'structures' || type === 'networks';
}
