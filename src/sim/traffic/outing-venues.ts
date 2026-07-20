import {
  LEISURE_GARDEN_MAX_CELLS,
  LEISURE_NEAREST_CHOICES,
  LEISURE_PARK_MAX_CELLS,
} from '../constants/activities';
import { GRID_WIDTH } from '../constants/map';
import { leisureVenuePreference } from '../citizen-profile';
import type { CitySim } from '../city';
import type {
  CitizenProfile,
  CityWorld,
  LeisureVenueType,
} from '../types';
import { accessCell, buildingAccessCell } from './pathing';
import { validShop } from './pedestrians';

/** Every live, staffed, served, road-reachable commercial building, by id. */
export function shopCandidates(sim: CitySim): number[] {
  const shops: number[] = [];
  for (const id of [...sim.world.query('building')].sort((a, b) => a - b)) {
    if (validShop(sim.world, id) && buildingAccessCell(sim, id) !== null) shops.push(id);
  }
  return shops;
}

/** Every road-reachable park, by id. */
export function parkCandidates(sim: CitySim): number[] {
  const parks: number[] = [];
  for (const id of [...sim.world.query('structure')].sort((a, b) => a - b)) {
    if (sim.world.getComponent(id, 'structure')?.type !== 'park') continue;
    if (accessCell(sim, id) !== null) parks.push(id);
  }
  return parks;
}

/** Every road-reachable community garden, by id. */
export function gardenCandidates(sim: CitySim): number[] {
  const gardens: number[] = [];
  for (const id of [...sim.world.query('structure')].sort((a, b) => a - b)) {
    if (sim.world.getComponent(id, 'structure')?.type !== 'garden') continue;
    if (accessCell(sim, id) !== null) gardens.push(id);
  }
  return gardens;
}

/** Everywhere a free-time outing can end, gathered once per trip-system run. */
export interface OutingVenues {
  shops: number[];
  parks: number[];
  gardens: number[];
}

export function outingVenues(sim: CitySim): OutingVenues {
  return {
    shops: shopCandidates(sim),
    parks: parkCandidates(sim),
    gardens: gardenCandidates(sim),
  };
}

/**
 * The `limit` venues closest to a home that share its road component and lie
 * within `maxCells` (Manhattan, between road access cells), ascending by
 * (distance, entity id). Bounded insertion rather than a full sort keeps the
 * work O(venues x limit) and storage independent of city size.
 */
function nearestVenues(
  sim: CitySim,
  home: number,
  venues: number[],
  limit: number,
  maxCells = Number.POSITIVE_INFINITY,
): number[] {
  const homeCell = accessCell(sim, home);
  if (homeCell === null || limit <= 0) return [];
  const component = sim.roadGraph.cellComponent.get(homeCell);
  if (component === undefined) return [];
  const homeX = homeCell % GRID_WIDTH;
  const homeY = Math.floor(homeCell / GRID_WIDTH);

  const best: Array<{ venue: number; distance: number }> = [];
  for (const venue of venues) {
    const cell = accessCell(sim, venue);
    if (cell === null || sim.roadGraph.cellComponent.get(cell) !== component) continue;
    const distance =
      Math.abs((cell % GRID_WIDTH) - homeX) + Math.abs(Math.floor(cell / GRID_WIDTH) - homeY);
    if (distance > maxCells) continue;
    let at = best.length;
    while (
      at > 0 &&
      (best[at - 1].distance > distance ||
        (best[at - 1].distance === distance && best[at - 1].venue > venue))
    ) {
      at--;
    }
    if (at >= limit) continue;
    best.splice(at, 0, { venue, distance });
    if (best.length > limit) best.pop();
  }
  return best.map((entry) => entry.venue);
}

/** Uniform draw over a ranked list. Consumes no RNG for zero or one candidate. */
function pickVenue(w: CityWorld, ranked: number[]): number | null {
  if (ranked.length === 0) return null;
  if (ranked.length === 1) return ranked[0];
  return ranked[Math.floor(w.random() * ranked.length)];
}

/**
 * A shopping run takes the single nearest shop. Leisure tries the household's
 * preferred kind of green venue, then the other kind, then nearby shops. Each
 * viable venue kind consumes one RNG draw only when it offers a real choice.
 */
export function chooseOutingDestination(
  sim: CitySim,
  w: CityWorld,
  home: number,
  venues: OutingVenues,
  activity: 'shop' | 'leisure',
  profile?: CitizenProfile,
): number | null {
  if (activity === 'leisure') {
    const preferred = profile ? leisureVenuePreference(profile) : 'park';
    const kinds: readonly LeisureVenueType[] =
      preferred === 'park' ? ['park', 'garden'] : ['garden', 'park'];
    for (const kind of kinds) {
      const ranked = nearestVenues(
        sim,
        home,
        kind === 'park' ? venues.parks : venues.gardens,
        LEISURE_NEAREST_CHOICES,
        kind === 'park' ? LEISURE_PARK_MAX_CELLS : LEISURE_GARDEN_MAX_CELLS,
      );
      if (ranked.length > 0) return pickVenue(w, ranked);
    }
  }
  return pickVenue(
    w,
    nearestVenues(sim, home, venues.shops, activity === 'leisure' ? LEISURE_NEAREST_CHOICES : 1),
  );
}
