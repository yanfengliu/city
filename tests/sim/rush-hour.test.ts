import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { windowAt, type RoutineWindow } from '../../src/protocol/city-clock';
import { stats } from './helpers';
import type { CityCommands, ZoneType } from '../../src/sim/types';

/**
 * The emergent half of the D1 contract (simulation-realism.md § Daily
 * routines): nobody scripts a rush hour — households following their own
 * clock-anchored routines must PRODUCE morning and evening traffic peaks over
 * a quiet night, in a city grown organically from zoning.
 */
describe('emergent rush hour', () => {
  it('mornings and evenings peak while nights go quiet, with no scripted traffic curve', { timeout: 120_000 }, () => {
    const sim = createCitySim({ seed: 3, fieldsEnabled: true });
    sim.world.runMaintenance(() => sim.world.setState('treasury', 10_000_000));

    // A quarter-scale balanced grid (the acceptance-city recipe, smaller).
    const x0 = 8;
    const x1 = 44;
    const y0 = 8;
    const y1 = 40;
    const submit = (name: keyof CityCommands, data: object): void => {
      sim.world.submit(name, data as never);
    };
    for (let y = y0; y <= y1; y += 4) submit('placeRoad', { ax: x0, ay: y, bx: x1, by: y });
    for (let x = x0; x <= x1; x += 12) submit('placeRoad', { ax: x, ay: y0, bx: x, by: y1 });
    sim.world.step();
    const pattern: ZoneType[] = ['R', 'R', 'C', 'R', 'I', 'R', 'C', 'R'];
    let k = 0;
    for (let y = y0; y < y1; y += 4) {
      submit('zone', { zone: pattern[k % pattern.length], ax: x0, ay: y + 1, bx: x1, by: y + 3 });
      k++;
    }
    sim.world.step();

    // Let the city grow through day 1 into the first night, then sample one
    // full day of traffic by routine window.
    const firstNight = 2_200;
    for (let i = 0; i < firstNight; i++) sim.world.step();
    expect(stats(sim).citizens).toBeGreaterThan(30);

    const peak: Record<RoutineWindow, number> = { night: 0, morning: 0, day: 0, evening: 0 };
    const sum: Record<RoutineWindow, number> = { night: 0, morning: 0, day: 0, evening: 0 };
    const samples: Record<RoutineWindow, number> = { night: 0, morning: 0, day: 0, evening: 0 };
    for (let i = 0; i < 4_200; i++) {
      sim.world.step();
      if (i % 8 !== 0) continue;
      const window = windowAt(sim.world.tick);
      const vehicles = stats(sim).vehicles;
      peak[window] = Math.max(peak[window], vehicles);
      sum[window] += vehicles;
      samples[window]++;
    }
    for (const window of ['night', 'morning', 'day', 'evening'] as const) {
      expect(samples[window], `window ${window} sampled`).toBeGreaterThan(0);
    }

    const nightMean = sum.night / samples.night;
    // Measured at introduction (seed 3): morning peak 23, evening peak 27,
    // night peak 0, night mean 0.0, day mean 0.01 — a decisive double hump.
    // Real traffic, not a trickle: the commute peaks are absolute crowds…
    expect(peak.morning).toBeGreaterThanOrEqual(8);
    expect(peak.evening).toBeGreaterThanOrEqual(8);
    // …and tower over the night baseline, which the routine leaves near-empty.
    expect(peak.morning).toBeGreaterThanOrEqual(3 * Math.max(1, nightMean));
    expect(peak.evening).toBeGreaterThanOrEqual(3 * Math.max(1, nightMean));
    // The quiet night is genuinely quiet next to the day's business.
    expect(nightMean).toBeLessThan(Math.max(peak.morning, peak.evening) / 3);
  });
});
