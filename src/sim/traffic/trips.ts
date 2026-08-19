import {
  MAX_PEDESTRIANS,
  MAX_VEHICLES,
  PEDESTRIAN_WORK_MAX_CELLS,
  TRIPS_PER_RUN,
  TRIP_RETRY_TICKS,
} from '../constants/traffic';
import { GRID_WIDTH } from '../constants/map';
import { CITIZEN_PRIMARY_MEMBER_ID } from '../constants/citizens';
import {
  appendCitizenLifeEvent,
  profileForCitizen,
  travellerForActivity,
  travellerForLeisureVenue,
} from '../citizen-profile';
import {
  departureOffsets,
  homeDepartureAt,
  outingAllowed,
  restUntilTick,
  workDepartureAt,
} from '../routine';
import { windowAt, windowStart } from '../../protocol/city-clock';
import { markStranded } from '../happiness';
import { SCHOOL_DEPART_SPREAD_TICKS } from '../constants/routine';
import { memberOffset, schoolDepartureAt } from '../routine';
import { hasStoredCitizenProfile } from '../citizen-profile';
import {
  memberSlots,
  schoolFor,
  upsertMemberSlot,
  dropMemberSlot,
} from './schools';
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
  // Members already out on their own trip cannot also carry the household's.
  // The override matters as much as the default here: a park or garden outing
  // names its traveller by venue affinity, which lands on the youngest member
  // — the same child most likely to still be walking home from school.
  const busy = new Set(memberSlots(w, citizenId).map((slot) => slot.memberId));
  const preferred = memberOverride ?? travellerForActivity(profile, activity, busy);
  const memberId = busy.has(preferred)
    ? travellerForActivity(profile, activity, busy)
    : preferred;
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
 * A night in: no agent, just the household at home until its own morning
 * commute moment. The plan flips back to work as the rest starts, so a
 * resting household can never sit at home indefinitely.
 */
function restAtHome(sim: CitySim, w: CityWorld, citizenId: number): void {
  const citizen = w.getComponent(citizenId, 'citizen');
  if (!citizen) return;
  const offsets = departureOffsets(
    sim.seed,
    citizenId,
    w.getEntityGeneration(citizenId),
    citizen.home,
  );
  const until = restUntilTick(w.tick, offsets.morning);
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
 * The member half of one household's turn (D2): start a due school run for
 * each child/teen member, and walk a dismissed child home. Shares the turn's
 * walker budget, and profiles only materialize once a run actually starts.
 */
function considerSchoolRuns(
  sim: CitySim,
  w: CityWorld,
  citizenId: number,
  capacity: { walkers: number; vehicles: number },
): void {
  const citizen = w.getComponent(citizenId, 'citizen');
  if (!citizen) return;
  const slots = memberSlots(w, citizenId);

  // Due walks home first — dismissal is slot-scheduled, not window-gated.
  for (const slot of slots) {
    if (slot.purpose !== 'school' || slot.phase !== 'atPlace' || slot.waitUntil > w.tick) continue;
    if (capacity.walkers >= MAX_PEDESTRIANS) return;
    if (
      !w.isAlive(slot.place) ||
      w.getEntityGeneration(slot.place) !== slot.placeGen ||
      w.getComponent(slot.place, 'structure')?.type !== 'school'
    ) {
      // The school died while class was in: the child is simply home.
      dropMemberSlot(w, citizenId, slot.memberId);
      continue;
    }
    const cells = findRoadCellPath(sim, slot.place, citizen.home);
    if (!cells) {
      countDisconnected(w, citizenId);
      dropMemberSlot(w, citizenId, slot.memberId);
      continue;
    }
    spawnPedestrian(w, citizenId, cells, citizen.home, 'school', false, slot.memberId);
    upsertMemberSlot(w, citizenId, { ...slot, phase: 'toHome' });
    capacity.walkers++;
  }

  // New departures only in the morning window. The stored-profile check runs
  // before any materialization so the scan itself writes nothing.
  if (windowAt(w.tick) !== 'morning') return;
  const profile = w.getComponent(citizenId, 'citizenProfile');
  const members = hasStoredCitizenProfile(profile)
    ? profile.members
    : profileForCitizen(sim, citizenId, citizen).members;
  for (const member of members) {
    if (member.lifeStage !== 'child' && member.lifeStage !== 'teen') continue;
    if (memberSlots(w, citizenId).some((s) => s.memberId === member.id)) continue;
    if (capacity.walkers >= MAX_PEDESTRIANS) return;
    const offset = memberOffset(
      sim.seed,
      citizenId,
      w.getEntityGeneration(citizenId),
      citizen.home,
      member.id,
      SCHOOL_DEPART_SPREAD_TICKS,
    );
    if (schoolDepartureAt(w.tick, offset) > w.tick) continue;
    const school = schoolFor(sim, citizen.home);
    if (school === null) return; // no covering school: nobody in this home attends
    const cells = findRoadCellPath(sim, citizen.home, school);
    if (!cells) continue; // covered but unroutable today; tomorrow retries
    spawnPedestrian(w, citizenId, cells, school, 'school', true, member.id);
    upsertMemberSlot(w, citizenId, {
      memberId: member.id,
      phase: 'toPlace',
      place: school,
      placeGen: w.getEntityGeneration(school),
      purpose: 'school',
      waitUntil: w.tick,
    });
    capacity.walkers++;
  }
}

/**
 * Starts bounded, rotating work and free-time legs for employed households.
 * Transitional phases are excluded, so each citizen owns at most one agent —
 * the household's own agent; member slots add their own walkers (D2).
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

    // Member lives run on their own eligibility: a household whose primary is
    // mid-commute (or parked on a long dwell) still sends its child to school.
    const memberEligible: number[] = [];
    for (const id of [...w.query('citizen')].sort((a, b) => a - b)) {
      const citizen = w.getComponent(id, 'citizen');
      if (!citizen) continue;
      const slots = memberSlots(w, id);
      const hasDue = slots.some(
        (s) => s.phase === 'atPlace' && s.waitUntil <= w.tick,
      );
      // Morning departures need a scan; other windows only service due slots.
      // No employment gate: a jobless household's children still attend.
      if (hasDue || windowAt(w.tick) === 'morning') {
        memberEligible.push(id);
      }
    }
    const memberCursor =
      ((w.getState('memberTripCursor') as number | undefined) ?? 0) %
      Math.max(1, memberEligible.length);
    const memberConsidered = Math.min(TRIPS_PER_RUN, memberEligible.length);
    for (let n = 0; n < memberConsidered; n++) {
      const id = memberEligible[(memberCursor + n) % memberEligible.length];
      considerSchoolRuns(sim, w, id, capacity);
    }
    if (memberEligible.length > 0) {
      w.setState('memberTripCursor', memberCursor + memberConsidered);
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
      // The clock gate lives here, at the single decision point, so however
      // `waitUntil` was produced — arrival settle, retry, legacy save — no leg
      // starts outside its routine window (simulation-realism.md § Daily
      // routines). A blocked leg parks `waitUntil` at its scheduled moment.
      const offsets = departureOffsets(sim.seed, id, w.getEntityGeneration(id), citizen.home);
      if (citizen.phase === 'atWork') {
        const at = homeDepartureAt(w.tick, offsets.evening);
        if (at > w.tick) {
          w.patchComponent(id, 'citizen', (data) => {
            data.waitUntil = at;
          });
          continue;
        }
        startWorkLeg(sim, w, id, citizen.work, citizen.home, false, capacity);
      } else if (citizen.phase === 'atShop') {
        startOutingLeg(sim, w, id, false, venues, capacity);
      } else if (activity === 'rest') {
        restAtHome(sim, w, id);
      } else if (activity === 'shop' || activity === 'leisure') {
        if (!outingAllowed(w.tick)) {
          // Night converts a planned outing into a night in (restAtHome flips
          // the plan to work, so the errand is dropped, not queued); a morning
          // plan simply waits out the commute window and goes mid-morning.
          if (windowAt(w.tick) === 'night') {
            restAtHome(sim, w, id);
          } else {
            w.patchComponent(id, 'citizen', (data) => {
              data.waitUntil = windowStart(w.tick, 'day');
            });
          }
          continue;
        }
        startOutingLeg(sim, w, id, true, venues, capacity);
      } else {
        const at = workDepartureAt(w.tick, offsets.morning);
        if (at > w.tick) {
          w.patchComponent(id, 'citizen', (data) => {
            data.waitUntil = at;
          });
          continue;
        }
        startWorkLeg(sim, w, id, citizen.home, citizen.work, true, capacity);
      }
    }
    w.setState('tripCursor', cursor + considered);
  };
}
