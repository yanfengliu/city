import {
  HAPPINESS_BASE,
  HAPPINESS_COMMUTE_FREE_CELLS,
  HAPPINESS_COMMUTE_FULL_CELLS,
  HAPPINESS_COMMUTE_MAX,
  HAPPINESS_EMPLOYED,
  HAPPINESS_LAND_VALUE_NEUTRAL,
  HAPPINESS_LAND_VALUE_RANGE,
  HAPPINESS_LAND_VALUE_WEIGHT,
  HAPPINESS_NO_HOME,
  HAPPINESS_PER_COVERED_SERVICE,
  HAPPINESS_PER_RUN,
  HAPPINESS_POWERED,
  HAPPINESS_SCALE,
  HAPPINESS_STRANDED,
  HAPPINESS_STRANDED_MEMORY_TICKS,
  HAPPINESS_TAX_PER_POINT,
  HAPPINESS_UNEMPLOYED,
  HAPPINESS_UNPOWERED,
  HAPPINESS_UNWATERED,
  HAPPINESS_WATERED,
} from './constants/happiness';
import { SERVICE_NAMES, SERVICE_TYPES } from './constants/services';
import { DEFAULT_TAX_RATE } from './constants/zoning';
import { taxRateOf } from './economy';
import { ZONE_NAMES } from './rejection';
import type { CitySim } from './city';
import type { CitizenComponent, CityWorld, ServiceType, ZoneType } from './types';

/**
 * Per-household quality of life in 0..1, derived only from state the city
 * already simulates: whether the home is served, which services reach it, what
 * the land is worth, whether anyone is employed and how far they travel,
 * whether a trip recently failed to route, and the tax on their zone.
 *
 * Every evaluation returns a breakdown as well as a number. A bare score
 * teaches a player nothing — the same principle that governs rejection
 * messages (AGENTS.md: diagnostics are a product surface) applies to any
 * number the game asks a player to act on.
 */

export type HappinessFactorId =
  | 'home'
  | 'power'
  | 'water'
  | 'services'
  | 'landValue'
  | 'employment'
  | 'commute'
  | 'stranded'
  | 'taxes';

export interface HappinessFactor {
  /** Stable key for UI grouping; never shown to a player. */
  id: HappinessFactorId;
  /** One sentence naming the measured input, not merely its direction. */
  label: string;
  /** Signed contribution to the 0..1 score. */
  delta: number;
}

export interface HappinessBreakdown {
  /** The final, clamped and rounded score. */
  score: number;
  /** Neutral starting point every factor moves away from. */
  base: number;
  /** Base plus every factor, before the 0..1 clamp. */
  raw: number;
  /** Every factor evaluated, in a fixed order — zero-delta ones included. */
  factors: HappinessFactor[];
}

/** The stored score, substituting the neutral base for pre-happiness saves. */
export function citizenHappiness(citizen: CitizenComponent): number {
  return citizen.happiness ?? HAPPINESS_BASE;
}

/** True while a household still remembers a trip that could not be routed. */
export function recentlyStranded(w: CityWorld, citizen: CitizenComponent): boolean {
  const at = citizen.strandedAt;
  return at !== null && at !== undefined && w.tick - at <= HAPPINESS_STRANDED_MEMORY_TICKS;
}

/**
 * Records that this household's trip could not be routed. Called wherever
 * `disconnectedTrips` is incremented for a specific citizen, so the global
 * counter and the personal memory can never disagree.
 */
export function markStranded(w: CityWorld, citizenId: number): void {
  if (!w.getComponent(citizenId, 'citizen')) return;
  const tick = w.tick;
  w.patchComponent(citizenId, 'citizen', (data) => {
    data.strandedAt = tick;
  });
}

function round(value: number): number {
  return Math.round(value * HAPPINESS_SCALE) / HAPPINESS_SCALE;
}

function cellLabel(x: number, y: number): string {
  return `(${x}, ${y})`;
}

/** Which of the four services cover a cell, in the canonical service order. */
function coveringServices(sim: CitySim, x: number, y: number): ServiceType[] {
  const covering: ServiceType[] = [];
  for (const service of SERVICE_TYPES) {
    if (sim.fields.coverage[service].getAt(x, y) > 0) covering.push(service);
  }
  return covering;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function serviceFactor(sim: CitySim, x: number, y: number): HappinessFactor {
  const covering = coveringServices(sim, x, y);
  const missing = SERVICE_TYPES.filter((service) => !covering.includes(service));
  const label =
    covering.length === 0
      ? `No service reaches home — ${list(missing.map((s) => SERVICE_NAMES[s]))} are all out of range`
      : `${list(covering.map((s) => SERVICE_NAMES[s]))} ` +
        `cover${covering.length === 1 ? 's' : ''} home (${covering.length} of ${SERVICE_TYPES.length})`;
  return { id: 'services', label, delta: HAPPINESS_PER_COVERED_SERVICE * covering.length };
}

function landValueFactor(sim: CitySim, x: number, y: number): HappinessFactor {
  const value = sim.fields.landValue.getAt(x, y);
  const delta =
    (HAPPINESS_LAND_VALUE_WEIGHT * (value - HAPPINESS_LAND_VALUE_NEUTRAL)) /
    HAPPINESS_LAND_VALUE_RANGE;
  return {
    id: 'landValue',
    label:
      `Land value ${Math.round(value)} at home ` +
      `(${HAPPINESS_LAND_VALUE_NEUTRAL} is ordinary)`,
    delta,
  };
}

function employmentFactors(
  w: CityWorld,
  citizen: CitizenComponent,
  homeX: number,
  homeY: number,
): HappinessFactor[] {
  const work = citizen.work;
  const workPosition = work === null ? undefined : w.getComponent(work, 'position');
  if (work === null || !workPosition) {
    return [
      {
        id: 'employment',
        label: 'Unemployed — the employment system has found no reachable job',
        delta: HAPPINESS_UNEMPLOYED,
      },
      { id: 'commute', label: 'No commute — nobody in the household travels to work', delta: 0 },
    ];
  }
  const zone = w.getComponent(work, 'building')?.zone;
  const cells = commuteCells(homeX, homeY, workPosition.x, workPosition.y);
  return [
    {
      id: 'employment',
      label:
        `Works at the ${zone ? `${ZONE_NAMES[zone]} building` : 'workplace'} ` +
        `at ${cellLabel(workPosition.x, workPosition.y)}`,
      delta: HAPPINESS_EMPLOYED,
    },
    {
      id: 'commute',
      label:
        cells <= HAPPINESS_COMMUTE_FREE_CELLS
          ? `Commute ${cells} cells home to work — within the easy ${HAPPINESS_COMMUTE_FREE_CELLS}`
          : `Commute ${cells} cells home to work ` +
            `(up to ${HAPPINESS_COMMUTE_FREE_CELLS} cells costs nothing)`,
      delta: commuteDelta(cells),
    },
  ];
}

/** Straight-line grid distance home → work; the trip's own route may be longer. */
export function commuteCells(homeX: number, homeY: number, workX: number, workY: number): number {
  return Math.abs(homeX - workX) + Math.abs(homeY - workY);
}

function commuteDelta(cells: number): number {
  const over = cells - HAPPINESS_COMMUTE_FREE_CELLS;
  if (over <= 0) return 0;
  const span = HAPPINESS_COMMUTE_FULL_CELLS - HAPPINESS_COMMUTE_FREE_CELLS;
  return HAPPINESS_COMMUTE_MAX * Math.min(1, over / span);
}

function strandedFactor(w: CityWorld, citizen: CitizenComponent): HappinessFactor {
  if (!recentlyStranded(w, citizen)) {
    return { id: 'stranded', label: 'No trip has failed to find a route recently', delta: 0 };
  }
  const ago = w.tick - (citizen.strandedAt ?? w.tick);
  return {
    id: 'stranded',
    label: `A trip could not find a route ${ago} ticks ago — check road connectivity`,
    delta: HAPPINESS_STRANDED,
  };
}

function taxFactor(w: CityWorld, zone: ZoneType): HappinessFactor {
  const rate = taxRateOf(w, zone);
  const over = Math.max(0, rate - DEFAULT_TAX_RATE);
  return {
    id: 'taxes',
    label:
      over === 0
        ? `${ZONE_NAMES[zone]} tax ${rate}% — at or below the neutral ${DEFAULT_TAX_RATE}%`
        : `${ZONE_NAMES[zone]} tax ${rate}%, ${over} point${over === 1 ? '' : 's'} ` +
          `above the neutral ${DEFAULT_TAX_RATE}%`,
    delta: HAPPINESS_TAX_PER_POINT * over,
  };
}

/**
 * Evaluates one household against the live world. Pure with respect to the
 * simulation — it reads state and allocates a breakdown, never mutating — so
 * the staggered system and the on-demand detail query share one model.
 */
export function computeHappiness(sim: CitySim, citizenId: number): HappinessBreakdown | null {
  const w = sim.world;
  const citizen = w.getComponent(citizenId, 'citizen');
  if (!citizen) return null;

  const home = w.getComponent(citizen.home, 'building');
  const homePosition = w.getComponent(citizen.home, 'position');
  const factors: HappinessFactor[] = [];

  if (!home || !homePosition) {
    factors.push({
      id: 'home',
      label: `No home on record — building ${citizen.home} is gone`,
      delta: HAPPINESS_NO_HOME,
    });
    factors.push(strandedFactor(w, citizen));
  } else {
    const { x, y } = homePosition;
    factors.push({
      id: 'power',
      label: home.powered
        ? `Home at ${cellLabel(x, y)} has power`
        : `Home at ${cellLabel(x, y)} has no power`,
      delta: home.powered ? HAPPINESS_POWERED : HAPPINESS_UNPOWERED,
    });
    factors.push({
      id: 'water',
      label: home.watered
        ? `Home at ${cellLabel(x, y)} has running water`
        : `Home at ${cellLabel(x, y)} has no running water`,
      delta: home.watered ? HAPPINESS_WATERED : HAPPINESS_UNWATERED,
    });
    factors.push(serviceFactor(sim, x, y));
    factors.push(landValueFactor(sim, x, y));
    factors.push(...employmentFactors(w, citizen, x, y));
    factors.push(strandedFactor(w, citizen));
    factors.push(taxFactor(w, home.zone));
  }

  let raw = HAPPINESS_BASE;
  for (const entry of factors) {
    // A weight times a zero count yields -0 in JS, which a panel would print as
    // "-0.00". Normalise before anyone reads it.
    if (entry.delta === 0) entry.delta = 0;
    raw += entry.delta;
  }
  return {
    score: round(Math.min(1, Math.max(0, raw))),
    base: HAPPINESS_BASE,
    raw,
    factors,
  };
}

/**
 * Re-evaluates a bounded, rotating slice of households. The cursor mirrors the
 * trip system's: a COUNT per run, so the cost is flat however large the city
 * grows, and every household is revisited within a predictable number of runs.
 */
export function happinessSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const citizens = [...w.query('citizen')].sort((a, b) => a - b);
    if (citizens.length === 0) return;

    const cursor = ((w.getState('happinessCursor') as number | undefined) ?? 0) % citizens.length;
    const considered = Math.min(HAPPINESS_PER_RUN, citizens.length);
    for (let n = 0; n < considered; n++) {
      const id = citizens[(cursor + n) % citizens.length];
      const breakdown = computeHappiness(sim, id);
      if (!breakdown) continue;
      // Skip identical writes: a component patch is a diff whether or not the
      // value moved, and most households are steady between runs.
      if (w.getComponent(id, 'citizen')?.happiness === breakdown.score) continue;
      w.patchComponent(id, 'citizen', (data) => {
        data.happiness = breakdown.score;
      });
    }
    w.setState('happinessCursor', cursor + considered);
  };
}
