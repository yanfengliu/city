import { localTickOfFraction } from '../../protocol/city-clock';

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


/**
 * How far into the morning window a child's school departure can fall.
 * Narrower than the commute spread: the school day starts together-ish.
 */
export const SCHOOL_DEPART_SPREAD_TICKS = 384;

/** School lets out at 15:00; children walk home through the afternoon. */
export const SCHOOL_RETURN_FRACTION = 0.625;
export const SCHOOL_RETURN_LOCAL_TICK = localTickOfFraction(SCHOOL_RETURN_FRACTION);

/** Dismissal shades over a short span so the walk home is a stream, not a spike. */
export const SCHOOL_RETURN_SPREAD_TICKS = 96;
