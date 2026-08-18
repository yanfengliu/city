/**
 * Daily-routine pacing (docs/design/simulation-realism.md § Daily routines).
 * The window boundaries themselves live in `src/protocol/city-clock.ts`
 * because the renderer shares them; these tune only how households behave
 * inside those windows.
 */

/**
 * How far into the morning window a household's commute departure can fall.
 * Identity-hashed per household, so a district's departures shade across the
 * window into a rush instead of spiking on one tick. Kept below the ~696-tick
 * morning window so scheduled departures all begin while it is still morning.
 */
export const MORNING_DEPART_SPREAD_TICKS = 512;

/**
 * How far into the evening window the homeward departure can fall. The evening
 * window is 1,024 ticks; half keeps every scheduled departure well before
 * night while still spreading the return rush.
 */
export const EVENING_DEPART_SPREAD_TICKS = 512;

/**
 * Settling time after arriving home before the household considers its next
 * plan — you put the bags down before going back out. Fixed, not random: the
 * routine clock owns all daily timing.
 */
export const HOME_SETTLE_TICKS = 32;
