import { describe, expect, it } from 'vitest';
import {
  cityClock,
  clockTime,
  DAY_START_FRACTION,
  localTick,
  TICKS_PER_DAY,
  WINDOW_START_FRACTIONS,
  WINDOW_START_LOCAL_TICKS,
  windowAt,
  windowStart,
  type RoutineWindow,
} from '../../src/protocol/city-clock';

const WINDOWS: readonly RoutineWindow[] = ['night', 'morning', 'day', 'evening'];

describe('cityClock', () => {
  it('partitions every local tick into exactly one window', () => {
    const counts: Record<RoutineWindow, number> = { night: 0, morning: 0, day: 0, evening: 0 };
    for (let tick = 0; tick < TICKS_PER_DAY; tick++) {
      counts[windowAt(tick)]++;
    }
    const total = WINDOWS.reduce((sum, w) => sum + counts[w], 0);
    expect(total).toBe(TICKS_PER_DAY);
    // Every window is non-empty and sized by its fraction span (±1 for rounding).
    expect(counts.morning).toBe(WINDOW_START_LOCAL_TICKS.day + TICKS_PER_DAY - WINDOW_START_LOCAL_TICKS.morning);
    expect(counts.day).toBe(WINDOW_START_LOCAL_TICKS.evening - WINDOW_START_LOCAL_TICKS.day);
    expect(counts.evening).toBe(WINDOW_START_LOCAL_TICKS.night - WINDOW_START_LOCAL_TICKS.evening);
    expect(counts.night).toBe(WINDOW_START_LOCAL_TICKS.morning - WINDOW_START_LOCAL_TICKS.night);
  });

  it('keeps the renderer day-fraction formula exactly', () => {
    for (const tick of [0, 1, 1024, 1203, 4095, 4096, 40960, 123456]) {
      expect(cityClock(tick).dayFraction).toBe((tick / TICKS_PER_DAY + DAY_START_FRACTION) % 1);
    }
  });

  it('keeps the HUD day-counter formula exactly', () => {
    for (const tick of [0, 4095, 4096, 8191, 8192]) {
      expect(cityClock(tick).day).toBe(Math.floor(tick / TICKS_PER_DAY) + 1);
    }
  });

  it('opens each window at its declared fraction', () => {
    for (const window of WINDOWS) {
      const start = WINDOW_START_LOCAL_TICKS[window];
      expect(windowAt(start)).toBe(window);
      // The tick before a window start belongs to the previous window.
      expect(windowAt(start - 1)).not.toBe(window);
      // The start tick corresponds to the declared fraction (rounded once).
      const fraction = cityClock(start).dayFraction;
      expect(Math.abs(fraction - WINDOW_START_FRACTIONS[window])).toBeLessThan(1 / TICKS_PER_DAY);
    }
  });

  it('boots mid-morning so the first screen is sunlit and commuting is legal', () => {
    expect(cityClock(0).dayFraction).toBe(DAY_START_FRACTION);
    expect(cityClock(0).window).toBe('morning');
    expect(clockTime(0)).toBe('09:36');
  });

  it('windowStart returns this occurrence inside the window and the next outside it', () => {
    for (let tick = 0; tick < TICKS_PER_DAY * 2; tick += 13) {
      for (const window of WINDOWS) {
        const start = windowStart(tick, window);
        expect(windowAt(start)).toBe(window);
        expect(localTick(start)).toBe(WINDOW_START_LOCAL_TICKS[window]);
        if (windowAt(tick) === window) {
          expect(start).toBeLessThanOrEqual(tick);
          // Same occurrence: no full day between start and tick.
          expect(tick - start).toBeLessThan(TICKS_PER_DAY);
        } else {
          expect(start).toBeGreaterThan(tick);
          expect(start - tick).toBeLessThanOrEqual(TICKS_PER_DAY);
        }
      }
    }
  });

  it('is pure and stable across repeated reads', () => {
    for (const tick of [0, 999, 4096, 999999]) {
      expect(cityClock(tick)).toEqual(cityClock(tick));
      expect(windowAt(tick)).toBe(windowAt(tick));
    }
  });

  it('renders clock time monotonically within a day', () => {
    expect(clockTime(WINDOW_START_LOCAL_TICKS.morning)).toBe('06:00');
    // A minute is ~2.84 ticks; spot-check known anchors.
    expect(clockTime(WINDOW_START_LOCAL_TICKS.night)).toBe('22:04');
  });
});
