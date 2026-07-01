import type { ServiceType } from '../types';

/** Canonical service order — iteration order is part of determinism. */
export const SERVICE_TYPES: readonly ServiceType[] = [
  'fireStation',
  'police',
  'clinic',
  'school',
];

/** Services occupy a square footprint of this side, anchored top-left. */
export const SERVICE_FOOTPRINT = 2;

export const SERVICE_COST: Record<ServiceType, number> = {
  fireStation: 400,
  police: 400,
  clinic: 500,
  school: 500,
};

/** Upkeep per budget interval — consumed by the phase 5 budget system. */
export const SERVICE_UPKEEP: Record<ServiceType, number> = {
  fireStation: 8,
  police: 8,
  clinic: 10,
  school: 10,
};

/**
 * Coverage radius in cells. Distances use the CHEBYSHEV metric measured from
 * the service's anchor cell (top-left of its footprint); a coverage block
 * counts as covered when any of its cells lies within the radius.
 */
export const SERVICE_RADIUS: Record<ServiceType, number> = {
  fireStation: 24,
  police: 24,
  clinic: 32,
  school: 32,
};

export const COVERAGE_BLOCK_SIZE = 4;
