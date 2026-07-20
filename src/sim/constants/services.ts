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
  'garden',
];

/** Player-facing names, used in rejection messages and occupancy reports. */
export const SERVICE_LABELS: Record<ServiceType, string> = {
  fireStation: 'a fire station',
  police: 'a police station',
  clinic: 'a clinic',
  school: 'a school',
  park: 'a park',
  garden: 'a community garden',
};

/** Bare names for listing several at once; SERVICE_LABELS carries the article. */
export const SERVICE_NAMES: Record<ServiceType, string> = {
  fireStation: 'fire station',
  police: 'police station',
  clinic: 'clinic',
  school: 'school',
  park: 'park',
  garden: 'community garden',
};

export interface ServiceBenefitGroup {
  /** Player-facing need name used in household happiness explanations. */
  name: string;
  /** Any covered member satisfies the need; several members never stack it. */
  services: readonly ServiceType[];
}

/**
 * Essential civic needs. Park and garden are deliberately one green-space
 * family: variety remains visible and behavioral, but cannot buy duplicate
 * land-value or happiness credit at the same home.
 */
export const SERVICE_BENEFIT_GROUPS: readonly ServiceBenefitGroup[] = [
  { name: 'fire station', services: ['fireStation'] },
  { name: 'police station', services: ['police'] },
  { name: 'clinic', services: ['clinic'] },
  { name: 'school', services: ['school'] },
  { name: 'green space', services: ['park', 'garden'] },
];

/** Services occupy a square footprint of this side, anchored top-left. */
export const SERVICE_FOOTPRINT = 2;

/**
 * A park costs a fraction of a civic building on purpose: it is scenery and a
 * place to go, not staff and vehicles, so a young city can dot several around a
 * neighbourhood (150 = 15 road cells) long before it can afford its first
 * clinic. A community garden lowers the entry ticket to 90 but its radius-6
 * area per dollar is worse than the park's, making it local infill rather than
 * the universally efficient choice.
 */
export const SERVICE_COST: Record<ServiceType, number> = {
  fireStation: 400,
  police: 400,
  clinic: 500,
  school: 500,
  park: 150,
  garden: 90,
};

/**
 * Upkeep per budget interval — consumed by the phase 5 budget system. A park is
 * grass and benches rather than a crew on shift, so 3 keeps a ring of them
 * affordable where five fire stations (8 each) would not be. A garden costs 2
 * because its cultivated beds are smaller but still need ongoing care.
 */
export const SERVICE_UPKEEP: Record<ServiceType, number> = {
  fireStation: 8,
  police: 8,
  clinic: 10,
  school: 10,
  park: 3,
  garden: 2,
};

/**
 * Coverage radius in cells. Distances use the CHEBYSHEV metric measured from
 * the service's anchor cell (top-left of its footprint); a coverage block
 * counts as covered when any of its cells lies within the radius.
 *
 * A park lifts the streets around it, not a district: at 10 cells it reaches
 * well under half as far as a fire station, so covering a neighbourhood takes
 * several parks rather than one well-placed civic building — which is exactly
 * the shape of decision a park is meant to be. Gardens reach only 6 cells,
 * reserving them for gaps inside a neighbourhood.
 */
export const SERVICE_RADIUS: Record<ServiceType, number> = {
  fireStation: 24,
  police: 24,
  clinic: 32,
  school: 32,
  park: 10,
  garden: 6,
};

export const COVERAGE_BLOCK_SIZE = 4;
