import type { ServiceType } from '../types';

/**
 * Canonical service order — iteration order is part of determinism. APPEND new
 * services; never reorder or remove, or every seeded outcome and every recorded
 * session shifts underneath the change.
 */
export const SERVICE_TYPES: readonly ServiceType[] = [
  'fireStation',
  'police',
  'clinic',
  'school',
  'park',
];

/** Player-facing names, used in rejection messages and occupancy reports. */
export const SERVICE_LABELS: Record<ServiceType, string> = {
  fireStation: 'a fire station',
  police: 'a police station',
  clinic: 'a clinic',
  school: 'a school',
  park: 'a park',
};

/** Bare names for listing several at once; SERVICE_LABELS carries the article. */
export const SERVICE_NAMES: Record<ServiceType, string> = {
  fireStation: 'fire station',
  police: 'police station',
  clinic: 'clinic',
  school: 'school',
  park: 'park',
};

/** Services occupy a square footprint of this side, anchored top-left. */
export const SERVICE_FOOTPRINT = 2;

/**
 * A park costs a fraction of a civic building on purpose: it is scenery and a
 * place to go, not staff and vehicles, so a young city can dot several around a
 * neighbourhood (150 = 15 road cells) long before it can afford its first
 * clinic. Cheap enough to be a habit, dear enough to be a choice.
 */
export const SERVICE_COST: Record<ServiceType, number> = {
  fireStation: 400,
  police: 400,
  clinic: 500,
  school: 500,
  park: 150,
};

/**
 * Upkeep per budget interval — consumed by the phase 5 budget system. A park is
 * grass and benches rather than a crew on shift, so 3 keeps a ring of them
 * affordable where five fire stations (8 each) would not be.
 */
export const SERVICE_UPKEEP: Record<ServiceType, number> = {
  fireStation: 8,
  police: 8,
  clinic: 10,
  school: 10,
  park: 3,
};

/**
 * Coverage radius in cells. Distances use the CHEBYSHEV metric measured from
 * the service's anchor cell (top-left of its footprint); a coverage block
 * counts as covered when any of its cells lies within the radius.
 *
 * A park lifts the streets around it, not a district: at 10 cells it reaches
 * well under half as far as a fire station, so covering a neighbourhood takes
 * several parks rather than one well-placed civic building — which is exactly
 * the shape of decision a park is meant to be.
 */
export const SERVICE_RADIUS: Record<ServiceType, number> = {
  fireStation: 24,
  police: 24,
  clinic: 32,
  school: 32,
  park: 10,
};

export const COVERAGE_BLOCK_SIZE = 4;
