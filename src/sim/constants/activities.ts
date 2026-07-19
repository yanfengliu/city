import type { FreeTimeActivity } from '../types';

/**
 * What a household does with an evening. Work is not here: the cycle alternates
 * work with one free-time slot, and these are the options for that slot.
 *
 * FIXED order — the weighted pick walks this array, so reordering it changes
 * every seeded outcome and every recorded session.
 */
export const FREE_TIME_ACTIVITIES: readonly FreeTimeActivity[] = ['shop', 'leisure', 'rest'];

/** Restocking the household: the everyday errand, always on the table. */
export const FREE_TIME_SHOP_WEIGHT = 4;
/** An evening out, scaled by happiness — a miserable household does not go out. */
export const FREE_TIME_LEISURE_WEIGHT = 3;
/** Staying in, always possible. */
export const FREE_TIME_REST_WEIGHT = 1;
/** Extra pull toward staying in, scaled by how unhappy the household is. */
export const FREE_TIME_REST_UNHAPPY_WEIGHT = 3;
/** Extra pull toward staying in after a trip that could not be routed. */
export const FREE_TIME_REST_STRANDED_WEIGHT = 4;

/**
 * An evening out picks uniformly among this many nearest reachable shops
 * (a shopping run always takes the single nearest). Bounded so a night out is
 * a neighbourhood trip rather than a walk across the whole city.
 */
export const LEISURE_NEAREST_CHOICES = 6;

/** Households linger longer on an evening out than on a shopping run. */
export const LEISURE_WAIT_BASE = 96;
export const LEISURE_WAIT_VARIANCE = 96;

/** A night in: no agent spawns, the household simply stays home this long. */
export const REST_BASE_TICKS = 192;
export const REST_VARIANCE_TICKS = 192;
