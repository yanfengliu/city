/**
 * When a household's day happens (docs/design/simulation-realism.md § Daily
 * routines): pure schedule arithmetic over the shared civic clock. The trip
 * system is the sole authority that applies these — arrival sites only park a
 * settle or dwell, so however `waitUntil` was produced (legacy save, retry,
 * stranding), the clock re-gates the next leg here.
 *
 * Offsets are identity-hashed like citizen profiles — zero world-RNG draws —
 * so a district's departures shade deterministically across a window.
 */
import { localTick, TICKS_PER_DAY, windowAt, windowStart } from '../protocol/city-clock';
import {
  EVENING_DEPART_SPREAD_TICKS,
  MORNING_DEPART_SPREAD_TICKS,
  SCHOOL_RETURN_LOCAL_TICK,
} from './constants/routine';
import { identityWord } from './citizen-profile';

const MORNING_SALT = 0x60a7f00d;
const EVENING_SALT = 0x3a55e77e;

export interface DepartureOffsets {
  /** Ticks into the morning window when this household's commute leaves. */
  morning: number;
  /** Ticks into the evening window when this household heads home. */
  evening: number;
}

/** This household's personal departure moments, stable across the city's life. */
export function departureOffsets(
  seed: number,
  citizen: number,
  generation: number,
  home: number,
): DepartureOffsets {
  return {
    morning: identityWord(seed, citizen, generation, home, MORNING_SALT) % MORNING_DEPART_SPREAD_TICKS,
    evening: identityWord(seed, citizen, generation, home, EVENING_SALT) % EVENING_DEPART_SPREAD_TICKS,
  };
}

/**
 * The earliest tick ≥ now this household may leave for work: its offset moment
 * in the morning window, immediately during the day window (late starters,
 * fresh hires, loads restored mid-day), and next morning's moment otherwise.
 */
export function workDepartureAt(tick: number, morningOffset: number): number {
  const window = windowAt(tick);
  if (window === 'day') return tick;
  if (window === 'morning') {
    return Math.max(tick, windowStart(tick, 'morning') + morningOffset);
  }
  return windowStart(tick, 'morning') + morningOffset;
}

/**
 * The earliest tick ≥ now a worker may head home: its offset moment in the
 * evening window, immediately at night (a very late day still ends), and this
 * cycle's evening moment while morning or day is in force.
 */
export function homeDepartureAt(tick: number, eveningOffset: number): number {
  const window = windowAt(tick);
  if (window === 'night') return tick;
  if (window === 'evening') {
    return Math.max(tick, windowStart(tick, 'evening') + eveningOffset);
  }
  return windowStart(tick, 'evening') + eveningOffset;
}

/** Outings — shopping runs and evenings out — belong to the day and evening. */
export function outingAllowed(tick: number): boolean {
  const window = windowAt(tick);
  return window === 'day' || window === 'evening';
}

/**
 * When a night in ends: the next work-departure moment. Through the evening
 * and night that is tomorrow's commute; resting mid-morning collapses into
 * "go to work now" (no skipped workday), and resting during the day window
 * sleeps through to tomorrow's moment.
 */
export function restUntilTick(tick: number, morningOffset: number): number {
  if (windowAt(tick) === 'day') return windowStart(tick, 'morning') + morningOffset;
  return workDepartureAt(tick, morningOffset);
}

const SCHOOL_SALT = 0x5c400157;

/**
 * A named member's own schedule offset — the household hash re-salted by the
 * member, so siblings leave at different moments. Zero world-RNG draws.
 */
export function memberOffset(
  seed: number,
  citizen: number,
  generation: number,
  home: number,
  memberId: number,
  spread: number,
): number {
  return (
    identityWord(seed, citizen, generation, home, SCHOOL_SALT ^ Math.imul(memberId + 1, 0x9e3779b1)) %
    spread
  );
}

/**
 * School departures belong strictly to the morning: a child past today's
 * moment goes now; outside the morning window the next chance is tomorrow.
 * No day-window late start — miss the morning, stay home (D3 will surface
 * chronic misses; a load at noon simply starts attending tomorrow).
 */
export function schoolDepartureAt(tick: number, offset: number): number {
  if (windowAt(tick) === 'morning') {
    return Math.max(tick, windowStart(tick, 'morning') + offset);
  }
  return windowStart(tick, 'morning') + offset;
}

/**
 * The dismissal this child is walking toward: the 15:00 bell plus their own
 * dawdle, first occurrence after they SET OUT.
 *
 * Anchoring to departure rather than to the wall clock is the whole point. The
 * morning window wraps past local midnight, so a child departing at local 3600
 * is legitimately walking toward a bell at local 922 on the far side of the
 * wrap; judging lateness by the arrival tick alone cannot tell that ordinary
 * case apart from a genuine overshoot. Anchored at departure the two separate
 * cleanly, and a caller that finds arrival past this moment knows the school
 * day really is over.
 *
 * It matters because school legs have no path-length cap and the radius gate
 * is crow-flies: a winding road can take far longer than the distance suggests.
 * Before this, such an arrival booked TOMORROW's bell and the child dwelt at
 * school through the evening, all night, and the next school day — ~27 hours,
 * breaking the "at night the child is home" contract these tests assert.
 */
export function schoolDismissalAfter(departedAt: number, offset: number): number {
  const local = localTick(departedAt);
  const bell = SCHOOL_RETURN_LOCAL_TICK + offset;
  const into = local <= bell ? bell - local : bell + TICKS_PER_DAY - local;
  return departedAt + into;
}
