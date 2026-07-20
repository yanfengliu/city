import {
  MAX_PEDESTRIANS,
  MAX_VEHICLES,
  PEDESTRIAN_WORK_MAX_CELLS,
  TRIPS_PER_RUN,
  TRIP_RETRY_TICKS,
} from '../constants/traffic';
import { GRID_WIDTH } from '../constants/map';
import { CITIZEN_PRIMARY_MEMBER_ID } from '../constants/citizens';
import { restUntil } from '../activities';
import {
  appendCitizenLifeEvent,
  profileForCitizen,
  travellerForActivity,
  travellerForLeisureVenue,
} from '../citizen-profile';
import { markStranded } from '../happiness';
import type { CitySim } from '../city';
import type { CityWorld, PedestrianPurpose, VehicleLeg } from '../types';
import {
  buildingAccessNode,
  findNodePath,
  findRoadCellPath,
  nodePathToLegs,
} from './pathing';
import { spawnPedestrian } from './pedestrians';
import {
  chooseOutingDestination,
  outingVenues,
  type OutingVenues,
} from './outing-venues';
import { spawnBlocked } from './vehicles';

export {
  chooseOutingDestination,
  gardenCandidates,
  outingVenues,
  parkCandidates,
  shopCandidates,
} from './outing-venues';

/**
 * One trip gave up for want of a route. The global counter drives the HUD
 * warning; the per-citizen mark lets that household's happiness and its next
 * plan reflect the failure it personally hit.
 */
function countDisconnected(w: CityWorld, citizenId: number): void {
  w.setState(
    'disconnectedTrips',
    ((w.getState('disconnectedTrips') as number | undefined) ?? 0) + 1,
  );
  markStranded(w, citizenId);
}

/** Materializes legacy identity on first action and names this trip's person. */
function setTripTraveller(
  sim: CitySim,
  w: CityWorld,
  citizenId: number,
  activity: 'work' | 'shop' | 'leisure' | 'rest',
  memberOverride?: number,
): number | null {
  const citizen = w.getComponent(citizenId, 'citizen');
  if (!citizen) return null;
  const profile = profileForCitizen(sim, citizenId, citizen);
  const memberId = memberOverride ?? travellerForActivity(profile, activity);
  if (citizen.travellerMemberId !== memberId || (activity !== 'rest' && citizen.restUntil != null)) {
    w.patchComponent(citizenId, 'citizen', (data) => {
      data.travellerMemberId = memberId;
      if (activity !== 'rest') data.restUntil = null;
    });
  }
  return memberId;
}

/** Spawns a vehicle entity for a citizen at the first cell of its route. */
export function spawnVehicle(
  sim: CitySim,
  w: CityWorld,
  citizen: number,
  legs: VehicleLeg[],
  toWork: boolean,
  destination: number,
): void {
  const vehicle = w.createEntity();
  const firstEdge = sim.roadGraph.edges[legs[0].edge];
  const startCell = legs[0].reverse ? firstEdge.cells[firstEdge.cells.length - 1] : firstEdge.cells[0];
  w.setPosition(vehicle, { x: startCell % GRID_WIDTH, y: Math.floor(startCell / GRID_WIDTH) });
  w.addComponent(vehicle, 'vehicle', {
    citizen,
    citizenGen: w.getEntityGeneration(citizen),
    destination,
    destinationGen: w.getEntityGeneration(destination),
    legs,
    legIndex: 0,
    t: 0,
    toWork,
  });
  sim.edgeCounts.set(legs[0].edge, (sim.edgeCounts.get(legs[0].edge) ?? 0) + 1);
}

function workPurpose(w: CityWorld, workplace: number): PedestrianPurpose {
  return w.getComponent(workplace, 'building')?.zone === 'C'
    ? 'commercial-work'
    : 'industrial-work';
}

function beginWalking(
  w: CityWorld,
  citizen: number,
  cells: number[],
  destination: number,
  purpose: PedestrianPurpose,
  outbound: boolean,
): void {
  w.patchComponent(citizen, 'citizen', (data) => {
    data.phase = outbound ? (purpose === 'shopping' ? 'toShop' : 'toWork') : 'toHome';
  });
  spawnPedestrian(w, citizen, cells, destination, purpose, outbound);
}

function legForCellStep(sim: CitySim, fromCell: number, toCell: number): VehicleLeg | null {
  const candidates = new Set<number>();
  const fromInterior = sim.roadGraph.cellToEdge.get(fromCell);
  const toInterior = sim.roadGraph.cellToEdge.get(toCell);
  if (fromInterior !== undefined) candidates.add(fromInterior);
  if (toInterior !== undefined) candidates.add(toInterior);
  for (const edge of sim.roadGraph.nodes.get(fromCell) ?? []) candidates.add(edge);
  for (const edge of sim.roadGraph.nodes.get(toCell) ?? []) candidates.add(edge);

  for (const edgeId of [...candidates].sort((a, b) => a - b)) {
    const cells = sim.roadGraph.edges[edgeId].cells;
    for (let i = 0; i + 1 < cells.length; i++) {
      if (cells[i] === fromCell && cells[i + 1] === toCell) {
        return { edge: edgeId, reverse: false };
      }
      if (cells[i] === toCell && cells[i + 1] === fromCell) {
        return { edge: edgeId, reverse: true };
      }
    }
  }
  return null;
}

/** Coarse whole-edge vehicle route for the one-node access-collapse case. */
function cellPathToLegs(sim: CitySim, cells: number[]): VehicleLeg[] | null {
  if (cells.length === 1) {
    const edge =
      sim.roadGraph.cellToEdge.get(cells[0]) ?? sim.roadGraph.nodes.get(cells[0])?.[0];
    return edge === undefined ? null : [{ edge, reverse: false }];
  }
  const legs: VehicleLeg[] = [];
  for (let i = 0; i + 1 < cells.length; i++) {
    const leg = legForCellStep(sim, cells[i], cells[i + 1]);
    if (!leg) return null;
    const previous = legs[legs.length - 1];
    if (!previous || previous.edge !== leg.edge || previous.reverse !== leg.reverse) {
      legs.push(leg);
    }
  }
  return legs;
}

function routeVehicle(
  sim: CitySim,
  fromBuilding: number,
  toBuilding: number,
  cells: number[],
): VehicleLeg[] | null {
  const from = buildingAccessNode(sim, fromBuilding);
  const to = buildingAccessNode(sim, toBuilding);
  const nodes = from !== null && to !== null ? findNodePath(sim, from, to) : null;
  const graphLegs = nodes ? nodePathToLegs(sim, nodes) : null;
  if (graphLegs && graphLegs.length > 0) return graphLegs;
  // Interior access cells on one or more edges can all collapse to the same
  // graph endpoint. Only this zero-node case uses the exact-cell fallback;
  // distinct nodes retain congestion-weighted A* routing.
  return from !== null && from === to ? cellPathToLegs(sim, cells) : graphLegs;
}

function retryLater(w: CityWorld, citizen: number): void {
  w.patchComponent(citizen, 'citizen', (data) => {
    data.waitUntil = w.tick + TRIP_RETRY_TICKS;
  });
}

/**
 * A night in: no agent, just a cooldown at home. The plan flips back to work
 * as it starts, so a resting household can never sit at home indefinitely.
 */
function restAtHome(sim: CitySim, w: CityWorld, citizenId: number): void {
  const until = restUntil(w);
  // `nextActivity` flips to work below to prevent an endless rest loop, but
  // the person currently represented remains the one taking the night in.
  setTripTraveller(sim, w, citizenId, 'rest');
  w.patchComponent(citizenId, 'citizen', (data) => {
    data.phase = 'home';
    data.waitUntil = until;
    data.nextActivity = 'work';
    data.restUntil = until;
  });
}

/** Starts one work leg, walking only short all-land routes. */
function startWorkLeg(
  sim: CitySim,
  w: CityWorld,
  citizenId: number,
  fromBuilding: number,
  toBuilding: number,
  outbound: boolean,
  capacity: { walkers: number; vehicles: number },
): void {
  setTripTraveller(sim, w, citizenId, 'work');
  const cells = findRoadCellPath(sim, fromBuilding, toBuilding);
  if (!cells) {
    countDisconnected(w, citizenId);
    retryLater(w, citizenId);
    return;
  }
  const purpose = workPurpose(w, outbound ? toBuilding : fromBuilding);
  const shouldWalk =
    cells.length <= PEDESTRIAN_WORK_MAX_CELLS &&
    !cells.some((cell) => sim.terrain.water[cell] === 1);
  if (shouldWalk) {
    if (capacity.walkers >= MAX_PEDESTRIANS) return;
    beginWalking(w, citizenId, cells, toBuilding, purpose, outbound);
    capacity.walkers++;
    return;
  }
  const legs = routeVehicle(sim, fromBuilding, toBuilding, cells);
  if (!legs || legs.length === 0) {
    countDisconnected(w, citizenId);
    retryLater(w, citizenId);
    return;
  }
  if (capacity.vehicles >= MAX_VEHICLES) return;
  // A car may not materialize inside another's headway gap — wait for the
  // curb space to clear (docs/design/simulation-realism.md T1).
  if (spawnBlocked(sim, w, legs[0])) {
    retryLater(w, citizenId);
    return;
  }
  w.patchComponent(citizenId, 'citizen', (data) => {
    data.phase = outbound ? 'toWork' : 'toHome';
  });
  spawnVehicle(sim, w, citizenId, legs, outbound, toBuilding);
  capacity.vehicles++;
}

/**
 * One leg of a free-time outing — out to a shop or green venue, or back home.
 * Every kind walks and stores its destination in `citizen.shop`, so the return
 * leg, cancel path, and detail panel need no second hot-component vocabulary.
 */
function startOutingLeg(
  sim: CitySim,
  w: CityWorld,
  citizenId: number,
  outbound: boolean,
  venues: OutingVenues,
  capacity: { walkers: number; vehicles: number },
): void {
  if (capacity.walkers >= MAX_PEDESTRIANS) return;
  const citizen = w.getComponent(citizenId, 'citizen');
  if (!citizen) return;
  if (outbound) {
    // `nextActivity` holds the outing in progress, so the return leg and the
    // detail panel can still tell an evening out from a shopping run.
    const activity = citizen.nextActivity === 'leisure' ? 'leisure' : 'shop';
    const profile = profileForCitizen(sim, citizenId, citizen);
    const shop = chooseOutingDestination(sim, w, citizen.home, venues, activity, profile);
    const cells = shop === null ? null : findRoadCellPath(sim, citizen.home, shop);
    if (shop === null || !cells) {
      w.patchComponent(citizenId, 'citizen', (data) => {
        data.nextActivity = 'work';
        data.shop = null;
        data.shopGen = null;
        data.waitUntil = w.tick + TRIP_RETRY_TICKS;
        data.travellerMemberId = CITIZEN_PRIMARY_MEMBER_ID;
      });
      return;
    }
    const structureType = w.getComponent(shop, 'structure')?.type;
    const memberId = setTripTraveller(
      sim,
      w,
      citizenId,
      activity,
      activity === 'leisure' && (structureType === 'park' || structureType === 'garden')
        ? travellerForLeisureVenue(profile, structureType)
        : undefined,
    );
    w.patchComponent(citizenId, 'citizen', (data) => {
      data.shop = shop;
      data.shopGen = w.getEntityGeneration(shop);
    });
    beginWalking(w, citizenId, cells, shop, 'shopping', true);
    appendCitizenLifeEvent(w, citizenId, {
      kind: 'outingDeparted',
      memberId: memberId ?? CITIZEN_PRIMARY_MEMBER_ID,
      place: shop,
      activity,
    });
    capacity.walkers++;
    return;
  }

  const shop = citizen.shop;
  if (
    shop === null ||
    shop === undefined ||
    !w.isAlive(shop) ||
    citizen.shopGen !== w.getEntityGeneration(shop)
  ) {
    w.patchComponent(citizenId, 'citizen', (data) => {
      data.phase = 'home';
      data.nextActivity = 'work';
      data.shop = null;
      data.shopGen = null;
      data.waitUntil = w.tick + TRIP_RETRY_TICKS;
      data.travellerMemberId = CITIZEN_PRIMARY_MEMBER_ID;
    });
    return;
  }
  const cells = findRoadCellPath(sim, shop, citizen.home);
  if (!cells) {
    countDisconnected(w, citizenId);
    retryLater(w, citizenId);
    return;
  }
  beginWalking(w, citizenId, cells, citizen.home, 'shopping', false);
  capacity.walkers++;
}

/**
 * Starts bounded, rotating work and free-time legs for employed households.
 * Transitional phases are excluded, so each citizen owns at most one agent.
 */
export function tripSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const capacity = {
      vehicles: [...w.query('vehicle')].length,
      walkers: [...w.query('pedestrian')].length,
    };
    if (capacity.vehicles >= MAX_VEHICLES && capacity.walkers >= MAX_PEDESTRIANS) return;

    const eligible: number[] = [];
    for (const id of [...w.query('citizen')].sort((a, b) => a - b)) {
      const citizen = w.getComponent(id, 'citizen');
      if (!citizen || citizen.work === null || citizen.waitUntil > w.tick) continue;
      if (citizen.phase === 'home' || citizen.phase === 'atWork' || citizen.phase === 'atShop') {
        eligible.push(id);
      }
    }
    if (eligible.length === 0) return;

    const venues = outingVenues(sim);
    const cursor = ((w.getState('tripCursor') as number | undefined) ?? 0) % eligible.length;
    const considered = Math.min(TRIPS_PER_RUN, eligible.length);
    for (let n = 0; n < considered; n++) {
      const id = eligible[(cursor + n) % eligible.length];
      const citizen = w.getComponent(id, 'citizen');
      if (!citizen || citizen.work === null) continue;
      const activity = citizen.nextActivity ?? 'work';
      if (citizen.phase === 'atWork') {
        startWorkLeg(sim, w, id, citizen.work, citizen.home, false, capacity);
      } else if (citizen.phase === 'atShop') {
        startOutingLeg(sim, w, id, false, venues, capacity);
      } else if (activity === 'rest') {
        restAtHome(sim, w, id);
      } else if (activity === 'shop' || activity === 'leisure') {
        startOutingLeg(sim, w, id, true, venues, capacity);
      } else {
        startWorkLeg(sim, w, id, citizen.home, citizen.work, true, capacity);
      }
    }
    w.setState('tripCursor', cursor + considered);
  };
}
