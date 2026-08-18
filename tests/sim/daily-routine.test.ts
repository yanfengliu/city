import { describe, expect, it } from 'vitest';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import {
  TICKS_PER_DAY,
  WINDOW_START_LOCAL_TICKS,
  windowAt,
  windowStart,
} from '../../src/protocol/city-clock';
import {
  departureOffsets,
  homeDepartureAt,
  outingAllowed,
  workDepartureAt,
} from '../../src/sim/routine';
import {
  EVENING_DEPART_SPREAD_TICKS,
  MORNING_DEPART_SPREAD_TICKS,
} from '../../src/sim/constants/routine';
import { TRIP_INTERVAL } from '../../src/sim/constants/traffic';
import { citizenOf, seedBuilding, seedCitizen } from './helpers';

/** A flat street at row `y` with buildable land beside it. */
function prepareStreet(sim: CitySim, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    for (const row of [y, y + 1]) {
      const cell = cellIndex(x, row);
      sim.terrain.water[cell] = 0;
      sim.terrain.trees[cell] = 0;
      sim.terrain.elevation[cell] = sim.terrain.seaLevel;
    }
  }
  expect(sim.world.submit('placeRoad', { ax: x0, ay: y, bx: x1, by: y })).toBe(true);
  sim.world.step();
}

interface Transition {
  tick: number;
  from: string;
  to: string;
}

/** Steps `ticks`, recording every phase change per seeded citizen. */
function recordTransitions(
  sim: CitySim,
  citizens: readonly number[],
  ticks: number,
): Map<number, Transition[]> {
  const log = new Map<number, Transition[]>(citizens.map((id) => [id, []]));
  const last = new Map<number, string>(citizens.map((id) => [id, citizenOf(sim, id).phase]));
  for (let i = 0; i < ticks; i++) {
    sim.world.step();
    for (const id of citizens) {
      const phase = citizenOf(sim, id).phase;
      const previous = last.get(id);
      if (phase !== previous) {
        log.get(id)?.push({ tick: sim.world.tick, from: previous ?? '?', to: phase });
        last.set(id, phase);
      }
    }
  }
  return log;
}

function commuteCity(households: number): { sim: CitySim; citizens: number[] } {
  const sim = createCitySim({ seed: 7 });
  const y = 60;
  prepareStreet(sim, 20, 40, y);
  const work = seedBuilding(sim, { x: 38, y: y + 1, zone: 'I', jobsFilled: households });
  const citizens: number[] = [];
  for (let n = 0; n < households; n++) {
    const home = seedBuilding(sim, { x: 22 + n, y: y + 1, zone: 'R', residents: 1 });
    citizens.push(seedCitizen(sim, home, work));
  }
  return { sim, citizens };
}

describe('routine helpers', () => {
  it('offsets are deterministic, member-spread, and inside the declared spreads', () => {
    const seen = new Set<number>();
    for (let citizen = 1; citizen <= 24; citizen++) {
      const a = departureOffsets(7, citizen, 0, 900 + citizen);
      const b = departureOffsets(7, citizen, 0, 900 + citizen);
      expect(a).toEqual(b);
      expect(a.morning).toBeGreaterThanOrEqual(0);
      expect(a.morning).toBeLessThan(MORNING_DEPART_SPREAD_TICKS);
      expect(a.evening).toBeGreaterThanOrEqual(0);
      expect(a.evening).toBeLessThan(EVENING_DEPART_SPREAD_TICKS);
      seen.add(a.morning);
    }
    // Two dozen households do not all leave at the same moment.
    expect(seen.size).toBeGreaterThan(8);
  });

  it('work departures wait for morning, go immediately when late, and never start at night', () => {
    const morning = WINDOW_START_LOCAL_TICKS.morning;
    const offset = 100;
    // Before this cycle's offset moment inside morning: wait for the moment.
    expect(workDepartureAt(morning + 10, offset)).toBe(morning + offset);
    // Past the moment inside morning: go now.
    expect(workDepartureAt(morning + offset + 5, offset)).toBe(morning + offset + 5);
    // Day window: late start, go now.
    const dayTick = WINDOW_START_LOCAL_TICKS.day + 50;
    expect(workDepartureAt(dayTick, offset)).toBe(dayTick);
    // Evening and night: next morning's moment.
    for (const tick of [WINDOW_START_LOCAL_TICKS.evening + 5, WINDOW_START_LOCAL_TICKS.night + 5]) {
      const at = workDepartureAt(tick, offset);
      expect(at).toBe(windowStart(tick, 'morning') + offset);
      expect(at).toBeGreaterThan(tick);
      expect(windowAt(at)).toBe('morning');
    }
  });

  it('home departures wait for evening, and a very late worker leaves at night immediately', () => {
    const evening = WINDOW_START_LOCAL_TICKS.evening;
    const offset = 80;
    expect(homeDepartureAt(evening + 4, offset)).toBe(evening + offset);
    expect(homeDepartureAt(evening + offset + 9, offset)).toBe(evening + offset + 9);
    const nightTick = WINDOW_START_LOCAL_TICKS.night + 3;
    expect(homeDepartureAt(nightTick, offset)).toBe(nightTick);
    // Morning and day at work: this cycle's evening moment.
    const dayTick = WINDOW_START_LOCAL_TICKS.day + 7;
    expect(homeDepartureAt(dayTick, offset)).toBe(evening + offset);
  });

  it('outings are a day or evening thing', () => {
    expect(outingAllowed(WINDOW_START_LOCAL_TICKS.day + 1)).toBe(true);
    expect(outingAllowed(WINDOW_START_LOCAL_TICKS.evening + 1)).toBe(true);
    expect(outingAllowed(WINDOW_START_LOCAL_TICKS.night + 1)).toBe(false);
    expect(outingAllowed(WINDOW_START_LOCAL_TICKS.morning + 1)).toBe(false);
  });
});

describe('daily routine (scenario)', () => {
  it('work departures happen only in the morning or day windows across a full day', () => {
    const { sim, citizens } = commuteCity(3);
    const log = recordTransitions(sim, citizens, TICKS_PER_DAY + WINDOW_START_LOCAL_TICKS.day);
    let departures = 0;
    for (const transitions of log.values()) {
      for (const t of transitions) {
        if (t.to === 'toWork' && (t.from === 'home' || t.from === 'atShop')) {
          departures++;
          expect(['morning', 'day'], `work departure at tick ${t.tick} (${windowAt(t.tick)})`).toContain(
            windowAt(t.tick),
          );
        }
      }
    }
    expect(departures).toBeGreaterThan(0);
  });

  it('workers stay at work until the evening window opens', () => {
    const { sim, citizens } = commuteCity(3);
    const log = recordTransitions(sim, citizens, TICKS_PER_DAY);
    let returns = 0;
    for (const transitions of log.values()) {
      for (const t of transitions) {
        if (t.from === 'atWork') {
          returns++;
          expect(['evening', 'night'], `left work at tick ${t.tick} (${windowAt(t.tick)})`).toContain(
            windowAt(t.tick),
          );
        }
      }
    }
    expect(returns).toBeGreaterThan(0);
  });

  it('the night belongs to rest: no departure of any kind starts during the night window', () => {
    const { sim, citizens } = commuteCity(3);
    const log = recordTransitions(sim, citizens, TICKS_PER_DAY + WINDOW_START_LOCAL_TICKS.day);
    for (const transitions of log.values()) {
      for (const t of transitions) {
        if (t.from === 'home' && (t.to === 'toWork' || t.to === 'toShop')) {
          expect(windowAt(t.tick), `departure ${t.to} at night tick ${t.tick}`).not.toBe('night');
        }
      }
    }
  });

  it('second-morning departures stagger across households by identity', () => {
    const { sim, citizens } = commuteCity(4);
    const log = recordTransitions(sim, citizens, TICKS_PER_DAY + WINDOW_START_LOCAL_TICKS.day);
    const secondMorning = windowStart(TICKS_PER_DAY, 'morning');
    const departureTicks: number[] = [];
    for (const transitions of log.values()) {
      const departure = transitions.find(
        (t) => t.to === 'toWork' && t.tick >= secondMorning,
      );
      expect(departure, 'every household commutes on day 2').toBeDefined();
      if (departure) departureTicks.push(departure.tick);
    }
    for (const tick of departureTicks) {
      expect(tick).toBeGreaterThanOrEqual(secondMorning);
      expect(tick).toBeLessThan(secondMorning + MORNING_DEPART_SPREAD_TICKS + 2 * TRIP_INTERVAL);
    }
    // Identity-hashed offsets: four households do not all depart on one tick.
    expect(new Set(departureTicks).size).toBeGreaterThan(1);
  });

  it('a resting household wakes into its morning commute moment', () => {
    const { sim, citizens } = commuteCity(1);
    const id = citizens[0];
    // Run through the first evening into deep night.
    const nightTick = WINDOW_START_LOCAL_TICKS.night + 200;
    recordTransitions(sim, [id], nightTick);
    const citizen = citizenOf(sim, id);
    expect(citizen.phase).toBe('home');
    const secondMorning = windowStart(sim.world.tick, 'morning');
    expect(citizen.waitUntil).toBeGreaterThanOrEqual(secondMorning);
    expect(citizen.waitUntil).toBeLessThan(secondMorning + MORNING_DEPART_SPREAD_TICKS);
  });
});
