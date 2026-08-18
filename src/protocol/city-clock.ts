/**
 * The civic day — one pure clock shared by the sim (routine windows deciding
 * when households commute, go out, and rest), the renderer (sun position and
 * night glow), and the HUD (day counter and time of day), so "looks like
 * morning" and "behaves like morning" can never disagree
 * (docs/design/simulation-realism.md § Daily routines).
 *
 * The constants live here rather than in `sim/constants` for the signal-phase
 * reason: the renderer may import protocol modules but never sim ones.
 */

/** Ticks per full day/night cycle (20 TPS → ~205 s per day at 1×). */
export const TICKS_PER_DAY = 4096;

/**
 * Day fraction at tick 0 — the city boots mid-morning (09:36) so the first
 * screen is sunlit. Fraction semantics, shared with the scene's sun math:
 * 0 = midnight, 0.25 = sunrise (06:00), 0.5 = noon, 0.75 = sunset (18:00).
 */
export const DAY_START_FRACTION = 0.4;

export type RoutineWindow = 'night' | 'morning' | 'day' | 'evening';

/**
 * Where each routine window begins, as a day fraction. Morning opens at
 * sunrise and carries the commute out; evening carries the commute home and
 * outings; night is rest. The four windows partition the day exactly.
 */
export const WINDOW_START_FRACTIONS: Readonly<Record<RoutineWindow, number>> = {
  morning: 0.25, // 06:00 — sunrise; commutes depart
  day: 0.42, // 10:04 — late starters still head to work
  evening: 0.67, // 16:04 — workers head home, households go out
  night: 0.92, // 22:04 — the city sleeps
};

/** A window's start as a tick offset inside the day cycle (tick 0 = fraction 0.4). */
function localTickOf(fraction: number): number {
  const local = (((fraction - DAY_START_FRACTION) % 1) + 1) % 1;
  return Math.round(local * TICKS_PER_DAY) % TICKS_PER_DAY;
}

/**
 * Window starts in local-tick space, precomputed once so every consumer does
 * pure integer comparisons. With the 0.4 boot fraction: day 82, evening 1106,
 * night 2130, morning 3482 (wrapping through the day boundary to 82).
 */
export const WINDOW_START_LOCAL_TICKS: Readonly<Record<RoutineWindow, number>> = {
  morning: localTickOf(WINDOW_START_FRACTIONS.morning),
  day: localTickOf(WINDOW_START_FRACTIONS.day),
  evening: localTickOf(WINDOW_START_FRACTIONS.evening),
  night: localTickOf(WINDOW_START_FRACTIONS.night),
};

/** Tick folded into [0, TICKS_PER_DAY), safe for any integer tick. */
export function localTick(tick: number): number {
  return ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
}

/** The routine window containing `tick`. Pure; integer math only. */
export function windowAt(tick: number): RoutineWindow {
  const local = localTick(tick);
  const starts = WINDOW_START_LOCAL_TICKS;
  if (local >= starts.morning || local < starts.day) return 'morning';
  if (local < starts.evening) return 'day';
  if (local < starts.night) return 'evening';
  return 'night';
}

/**
 * Absolute tick of the start of the window occurrence containing-or-next-after
 * `tick`: if `tick` is inside `window`, the start of that occurrence (≤ tick);
 * otherwise the next time the window opens (> tick).
 */
export function windowStart(tick: number, window: RoutineWindow): number {
  const local = localTick(tick);
  const start = WINDOW_START_LOCAL_TICKS[window];
  if (windowAt(tick) === window) {
    // Morning wraps the day boundary: a local tick below `day`'s start sits in
    // the tail that began before tick 0 of this cycle.
    const into = local >= start ? local - start : local + TICKS_PER_DAY - start;
    return tick - into;
  }
  const until = start > local ? start - local : start + TICKS_PER_DAY - local;
  return tick + until;
}

export interface CityClock {
  /** 1-based day counter; matches the HUD's historical `floor(tick/day)+1`. */
  day: number;
  /** Sun position on [0, 1): 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  dayFraction: number;
  /** The routine window in force. */
  window: RoutineWindow;
}

/** The full clock reading at `tick`. Pure: same tick, same reading, anywhere. */
export function cityClock(tick: number): CityClock {
  return {
    day: Math.floor(tick / TICKS_PER_DAY) + 1,
    dayFraction: (tick / TICKS_PER_DAY + DAY_START_FRACTION) % 1,
    window: windowAt(tick),
  };
}

/** Clock time as "HH:MM" for the HUD and text state (24-hour civic time). */
export function clockTime(tick: number): string {
  const minutes = Math.floor(cityClock(tick).dayFraction * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
