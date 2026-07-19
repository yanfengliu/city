import { SERVICE_NAMES } from './constants/services';
import { cellIndex } from './grid';
import { ZONE_NAMES } from './rejection';
import {
  citizenHappiness,
  commuteCells,
  computeHappiness,
  type HappinessBreakdown,
} from './happiness';
import type { CitySim } from './city';
import type { CitizenActivity, CityWorld, TripPhase, ZoneType } from './types';

/**
 * Everything a "who is this person?" panel needs about one household, answered
 * on demand for a single entity — never streamed, so a city of thousands costs
 * nothing until the player actually clicks someone.
 */

/** A building this household is attached to, with the cell to fly the camera to. */
export interface CitizenPlace {
  entity: number;
  /** Top-left anchor of the footprint. */
  x: number;
  y: number;
  cell: number;
  zone: ZoneType;
  level: number;
  abandoned: boolean;
}

/** The walker or car currently carrying this household, if any. */
export interface CitizenAgent {
  kind: 'pedestrian' | 'vehicle';
  entity: number;
  generation: number;
}

export interface CitizenDetail {
  entity: number;
  generation: number;
  /** The stored 0..1 score the sim maintains on its staggered cadence. */
  happiness: number;
  /**
   * Live re-derivation of the same model, explaining that number factor by
   * factor. Computed at query time, so it can be a few ticks fresher than the
   * stored score in a city that is changing fast.
   */
  breakdown: HappinessBreakdown;
  phase: TripPhase;
  /** The plan in progress: commuting, or which free-time outing they chose. */
  activity: CitizenActivity;
  /** One sentence describing what this household is doing right now. */
  status: string;
  home: CitizenPlace | null;
  work: CitizenPlace | null;
  /** Where they are heading; null while they are at home, at work, or at a shop. */
  destination: CitizenPlace | null;
  agent: CitizenAgent | null;
  /** Current cell — the active agent's, or their home when they are not out. */
  x: number;
  y: number;
  cell: number;
  /** Tick before which they will not start the next leg. */
  waitUntil: number;
  /** Tick of their most recent unroutable trip, or null if none. */
  strandedAt: number | null;
  /** Manhattan home→work distance in cells; null when unemployed. */
  commuteCells: number | null;
}

function place(w: CityWorld, entity: number | null | undefined): CitizenPlace | null {
  if (entity === null || entity === undefined) return null;
  const building = w.getComponent(entity, 'building');
  const position = w.getComponent(entity, 'position');
  if (!building || !position) return null;
  return {
    entity,
    x: position.x,
    y: position.y,
    cell: cellIndex(position.x, position.y),
    zone: building.zone,
    level: building.level,
    abandoned: building.abandoned,
  };
}

function at(target: CitizenPlace | null): string {
  return target ? `(${target.x}, ${target.y})` : 'an unknown address';
}

/**
 * How the status line names an outing's venue. Read off the entity rather than a
 * CitizenPlace, because a CitizenPlace is missing in both cases the sentence
 * needs: a park is a service structure and never has one, and a household that
 * has ARRIVED reports no `destination` at all (it is not heading anywhere) yet
 * is plainly somewhere. "An unknown address" is then left for the one case that
 * really is unknown — the venue being gone.
 */
function venueLabel(w: CityWorld, target: number | null): string {
  const position = target === null ? undefined : w.getComponent(target, 'position');
  if (target === null || !position) return at(null);
  const structure = w.getComponent(target, 'structure');
  const where = `(${position.x}, ${position.y})`;
  return structure ? `the ${SERVICE_NAMES[structure.type]} at ${where}` : where;
}

/** The walker or car this household owns right now, in deterministic id order. */
function activeAgent(w: CityWorld, citizenId: number): {
  agent: CitizenAgent;
  destination: number | null;
} | null {
  for (const id of [...w.query('pedestrianPath', 'pedestrian')].sort((a, b) => a - b)) {
    const path = w.getComponent(id, 'pedestrianPath');
    if (path?.citizen !== citizenId) continue;
    return {
      agent: { kind: 'pedestrian', entity: id, generation: w.getEntityGeneration(id) },
      destination: path.destination,
    };
  }
  for (const id of [...w.query('vehicle')].sort((a, b) => a - b)) {
    const data = w.getComponent(id, 'vehicle');
    if (data?.citizen !== citizenId) continue;
    return {
      agent: { kind: 'vehicle', entity: id, generation: w.getEntityGeneration(id) },
      destination: data.destination ?? null,
    };
  }
  return null;
}

function travelVerb(agent: CitizenAgent | null): string {
  return agent?.kind === 'vehicle' ? 'Driving' : 'Walking';
}

/** "the industrial job at (44, 31)" — names the kind of place, not just the cell. */
function job(work: CitizenPlace | null): string {
  return work ? `the ${ZONE_NAMES[work.zone]} job at ${at(work)}` : `work at ${at(work)}`;
}

interface StatusInput {
  phase: TripPhase;
  activity: CitizenActivity;
  waitUntil: number;
  home: CitizenPlace | null;
  work: CitizenPlace | null;
  destination: CitizenPlace | null;
  /** Where they are heading, already named — a park has no CitizenPlace. */
  venue: string;
  agent: CitizenAgent | null;
}

/** One sentence a panel can print verbatim — what they are doing and where. */
function describe(input: StatusInput): string {
  const { phase, activity, waitUntil, home, work, destination, venue, agent } = input;
  switch (phase) {
    case 'toWork':
      return `${travelVerb(agent)} to ${job(destination ?? work)}`;
    case 'atWork':
      return `At ${job(work)} until tick ${waitUntil}`;
    case 'toShop':
      return activity === 'leisure'
        ? `${travelVerb(agent)} out for the evening to ${venue}`
        : `${travelVerb(agent)} to the shops at ${venue}`;
    case 'atShop':
      return activity === 'leisure'
        ? `Out for the evening at ${venue} until tick ${waitUntil}`
        : `At the shops at ${venue} until tick ${waitUntil}`;
    case 'toHome':
      return `${travelVerb(agent)} home to ${at(destination ?? home)}`;
    case 'home':
    default:
      if (activity === 'rest') return `Resting at home at ${at(home)} until tick ${waitUntil}`;
      if (activity === 'leisure') return `At home at ${at(home)}, heading out for the evening`;
      if (activity === 'shop') return `At home at ${at(home)}, about to go shopping`;
      return `At home at ${at(home)}, next trip is to work`;
  }
}

/**
 * Why there is no detail for this entity, in words a player or a playtest agent
 * can act on (AGENTS.md: error messages are a product surface). Null when the
 * entity really is a citizen and `citizenDetail` will answer.
 */
export function citizenDetailProblem(sim: CitySim, entity: number): string | null {
  const w = sim.world;
  if (!Number.isInteger(entity) || entity < 0) {
    return `citizen ${entity} is not an entity id — pass a whole number from a pedestrian's "citizen" field`;
  }
  if (!w.isAlive(entity)) {
    return `entity ${entity} is not alive — it was destroyed, or never existed in this city`;
  }
  if (!w.getComponent(entity, 'citizen')) {
    const kind = w.getComponent(entity, 'building')
      ? 'a building'
      : w.getComponent(entity, 'pedestrianPath')
        ? "a walker (pass its path's citizen id instead)"
        : w.getComponent(entity, 'vehicle')
          ? "a car (pass its citizen id instead)"
          : 'not a household';
    return `entity ${entity} is ${kind}, so it has no citizen to describe`;
  }
  return null;
}

/** Full detail for one household, or null when `citizenDetailProblem` explains why not. */
export function citizenDetail(sim: CitySim, entity: number): CitizenDetail | null {
  const w = sim.world;
  const citizen = w.getComponent(entity, 'citizen');
  if (!citizen) return null;
  const breakdown = computeHappiness(sim, entity);
  if (!breakdown) return null;

  const home = place(w, citizen.home);
  const work = place(w, citizen.work);
  const active = activeAgent(w, entity);
  const agent = active?.agent ?? null;
  // The live agent is authoritative for where they are heading; the phase's
  // implied target covers the tick before an agent has spawned.
  const target =
    active?.destination ??
    fallbackTarget(citizen.phase, citizen.home, citizen.work, citizen.shop);
  const destination = phaseIsTravel(citizen.phase) ? place(w, target) : null;
  // The outing sentence names the venue on both legs: the one being walked to,
  // and — once arrived, when `destination` is deliberately null — the one they
  // are sitting in.
  const venue = citizen.phase === 'atShop' ? (citizen.shop ?? null) : target;

  const position = agent ? w.getComponent(agent.entity, 'position') : undefined;
  const x = position?.x ?? home?.x ?? 0;
  const y = position?.y ?? home?.y ?? 0;
  const activity = citizen.nextActivity ?? 'work';

  return {
    entity,
    generation: w.getEntityGeneration(entity),
    happiness: citizenHappiness(citizen),
    breakdown,
    phase: citizen.phase,
    activity,
    status: describe({
      phase: citizen.phase,
      activity,
      waitUntil: citizen.waitUntil,
      home,
      work,
      destination,
      venue: venueLabel(w, venue),
      agent,
    }),
    home,
    work,
    destination,
    agent,
    x,
    y,
    cell: cellIndex(x, y),
    waitUntil: citizen.waitUntil,
    strandedAt: citizen.strandedAt ?? null,
    commuteCells:
      home && work ? commuteCells(home.x, home.y, work.x, work.y) : null,
  };
}

function phaseIsTravel(phase: TripPhase): boolean {
  return phase === 'toWork' || phase === 'toShop' || phase === 'toHome';
}

/** Target implied by the phase, for the tick where the agent has not spawned yet. */
function fallbackTarget(
  phase: TripPhase,
  home: number,
  work: number | null,
  shop: number | null | undefined,
): number | null {
  if (phase === 'toWork') return work;
  if (phase === 'toShop') return shop ?? null;
  return home;
}
