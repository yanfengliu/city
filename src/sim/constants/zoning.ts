import type { ZoneType } from '../types';

/**
 * Zone paint reach: land cells within this Chebyshev distance of a road.
 * Matches the maximum reach of growth (2x2 anchored on a road-adjacent cell) —
 * anything painted deeper could never develop.
 */
export const ZONE_MAX_ROAD_DISTANCE = 2;

export const GROWTH_INTERVAL = 4;
export const GROWTH_INTERVAL_OFFSET = 1;
/** Growth attempts per zone type per run while demand is positive. */
export const GROWTH_ATTEMPTS = 4;

export const LEVEL_INTERVAL = 16;
export const LEVEL_INTERVAL_OFFSET = 5;
export const MAX_LEVEL = 3;
export const LEVEL2_SCORE = 45;
export const LEVEL3_SCORE = 70;
export const LEVEL_UP_EVALS = 3;
export const ABANDON_SCORE = 12;
export const ABANDON_EVALS = 10;
/** Longer grace when only utilities are missing — ~60s at 1x, so onboarding does not mass-abandon (playtest round 1). */
export const UTILITY_ABANDON_EVALS = 75;
export const RECOVER_EVALS = 3;
/** Neutral inputs until later phases wire the real sources. */
export const DEFAULT_LAND_VALUE = 30;
/** Industrial desirability: weak land-value coupling + flat base so industry does not abandon from its own pollution. */
export const INDUSTRIAL_LAND_VALUE_WEIGHT = 0.1;
export const INDUSTRIAL_SCORE_BASE = 15;
export const RESIDENTIAL_LAND_VALUE_WEIGHT = 0.5;

/**
 * Residents (R) or job slots (C/I) per footprint cell by level (index level-1),
 * in citizen entities (households) — the canonical sim unit. Display population
 * multiplies by PEOPLE_PER_CITIZEN in the UI only.
 */
export const CAPACITY_PER_CELL: Record<ZoneType, [number, number, number]> = {
  R: [1, 2, 3],
  C: [1, 2, 3],
  I: [1, 2, 2],
};

export const DEMAND_INTERVAL = 32;
export const DEMAND_INTERVAL_OFFSET = 14;
export const DEFAULT_TAX_RATE = 9;

export const MOVE_IN_INTERVAL = 8;
export const MOVE_IN_INTERVAL_OFFSET = 3;
export const MOVE_IN_BASE = 1;
export const MOVE_IN_DEMAND_SCALE = 5;
/** Display population per citizen entity (a citizen ≈ a household). */
export const PEOPLE_PER_CITIZEN = 3;

/** R demand above this (but <= 0) still attracts a 1-per-run trickle into empty homes. */
export const MOVE_IN_TRICKLE_THRESHOLD = -0.3;

/** Vacancy beyond this many free homes stops deepening negative R demand. */
export const DEMAND_VACANCY_CAP = 16;

/** Bulldozed building cells stay ungrowable this long (rubble) — kills the bulldoze-then-build race (playtest round 2). */
export const REGROWTH_COOLDOWN_TICKS = 200;
