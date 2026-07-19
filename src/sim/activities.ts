import {
  FREE_TIME_ACTIVITIES,
  FREE_TIME_LEISURE_WEIGHT,
  FREE_TIME_REST_STRANDED_WEIGHT,
  FREE_TIME_REST_UNHAPPY_WEIGHT,
  FREE_TIME_REST_WEIGHT,
  FREE_TIME_SHOP_WEIGHT,
  REST_BASE_TICKS,
  REST_VARIANCE_TICKS,
} from './constants/activities';
import { citizenHappiness, recentlyStranded } from './happiness';
import type { CitizenComponent, CityWorld, FreeTimeActivity } from './types';

/**
 * What a household chooses to do with its free time. The cycle alternates work
 * with one free-time slot; this picks what fills that slot, weighted by how the
 * household is actually doing rather than by a fixed rotation.
 *
 * Randomness comes from `world.random()` only, and the option order is fixed in
 * `constants/activities.ts`, so a seed reproduces every evening in the city.
 */

/**
 * Relative pull of each option for one household. Exposed separately from the
 * pick so the weighting can be asserted (and explained) without consuming RNG.
 */
export function freeTimeWeights(
  w: CityWorld,
  citizen: CitizenComponent,
): Record<FreeTimeActivity, number> {
  const happiness = citizenHappiness(citizen);
  return {
    shop: FREE_TIME_SHOP_WEIGHT,
    // A content household goes out; a miserable one does not.
    leisure: FREE_TIME_LEISURE_WEIGHT * happiness,
    // ... and stays in instead, all the more so if it could not get anywhere
    // the last time it tried.
    rest:
      FREE_TIME_REST_WEIGHT +
      FREE_TIME_REST_UNHAPPY_WEIGHT * (1 - happiness) +
      (recentlyStranded(w, citizen) ? FREE_TIME_REST_STRANDED_WEIGHT : 0),
  };
}

/** One weighted draw over the fixed option order — exactly one `random()` call. */
export function pickFreeTimeActivity(
  w: CityWorld,
  citizen: CitizenComponent,
): FreeTimeActivity {
  const weights = freeTimeWeights(w, citizen);
  let total = 0;
  for (const activity of FREE_TIME_ACTIVITIES) total += Math.max(0, weights[activity]);

  const roll = w.random() * total;
  let cumulative = 0;
  for (const activity of FREE_TIME_ACTIVITIES) {
    cumulative += Math.max(0, weights[activity]);
    if (roll < cumulative) return activity;
  }
  // Float accumulation can leave `roll` a hair past the last boundary.
  return FREE_TIME_ACTIVITIES[FREE_TIME_ACTIVITIES.length - 1];
}

/** How long a household stays in before its next commute. */
export function restUntil(w: CityWorld): number {
  return w.tick + REST_BASE_TICKS + Math.floor(w.random() * REST_VARIANCE_TICKS);
}
