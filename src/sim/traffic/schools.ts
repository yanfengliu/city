/**
 * School runs — the first simultaneous member lives (D2,
 * docs/design/simulation-realism.md § Daily routines). A child or teen member
 * walks to the school covering the home in the morning window, dwells until
 * the 15:00 bell, and walks home — all while the household's own slot keeps
 * commuting, so placing a school is what creates school runs.
 *
 * State lives in the appended `memberTrip` component: a slot exists only
 * while a member is out or dwelling, absence means home, and a legacy
 * snapshot without the component is simply a city where everyone is home.
 * The member pass itself lives in trips.ts, which owns spawning; this module
 * owns school choice, slot mutation, and walker arrival/cancel consequences,
 * so pedestrians.ts → schools.ts stays a one-way import.
 */
import { SCHOOL_RETURN_SPREAD_TICKS } from '../constants/routine';
import { memberOffset, schoolDismissalAfter } from '../routine';
import { markStranded } from '../happiness';
import type { CitySim } from '../city';
import type {
  CityWorld,
  MemberTripSlot,
  PedestrianPathComponent,
} from '../types';
import { accessCell, buildingAccessCell } from './pathing';

/** Manhattan distance between two cell indices on the grid. */
function cellDistance(width: number, a: number, b: number): number {
  const ax = a % width;
  const ay = Math.floor(a / width);
  const bx = b % width;
  const by = Math.floor(b / width);
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * The school this home attends.
 *
 * The gate is the coverage layer itself — the very field the education overlay
 * paints and that growth's `educated` reads — rather than a third re-derivation
 * of the radius. Re-deriving it is what made "covered" and "attends" disagree:
 * coverage is CHEBYSHEV from the school's anchor cell (SERVICE_RADIUS), so a
 * diagonal home 22 east and 22 north read as solidly covered on the overlay
 * while an access-cell Manhattan gate of 32 rejected it at 44, and no child in
 * that home ever attended. Consuming the published field makes the three agree
 * by construction instead of by two implementations that happen to match.
 *
 * Among covered homes the choice is the nearest school SHARING THE HOME'S ROAD
 * COMPONENT, by access-cell Manhattan with id as tie-break — the ranking and
 * the reachability filter `nearestVenues` uses. Without the component filter a
 * nearer school across an unbridged river permanently shadowed a reachable one
 * and the child simply never went.
 *
 * A home covered only by a school on another road component still returns null:
 * that school is genuinely unwalkable, and D3 surfaces it as a diagnosable
 * "no reachable school" rather than pretending attendance.
 */
export function schoolFor(sim: CitySim, home: number): number | null {
  const position = sim.world.getComponent(home, 'position');
  if (!position || sim.fields.coverage.school.getAt(position.x, position.y) <= 0) return null;
  const homeAccess = buildingAccessCell(sim, home);
  if (homeAccess === null) return null;
  const component = sim.roadGraph.cellComponent.get(homeAccess);
  if (component === undefined) return null;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const id of [...sim.world.query('structure')].sort((a, b) => a - b)) {
    if (sim.world.getComponent(id, 'structure')?.type !== 'school') continue;
    const schoolAccess = accessCell(sim, id);
    if (schoolAccess === null) continue;
    if (sim.roadGraph.cellComponent.get(schoolAccess) !== component) continue;
    const distance = cellDistance(sim.terrain.width, homeAccess, schoolAccess);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

export function memberSlots(w: CityWorld, citizenId: number): MemberTripSlot[] {
  return w.getComponent(citizenId, 'memberTrip')?.slots ?? [];
}

function writeSlots(w: CityWorld, citizenId: number, slots: MemberTripSlot[]): void {
  const existing = w.getComponent(citizenId, 'memberTrip');
  if (slots.length === 0) {
    if (existing) w.removeComponent(citizenId, 'memberTrip');
    return;
  }
  if (existing) {
    w.patchComponent(citizenId, 'memberTrip', (data) => {
      data.slots = slots;
    });
  } else {
    w.addComponent(citizenId, 'memberTrip', { slots });
  }
}

/** Replaces the member's slot, keeping slots ordered by member for determinism. */
export function upsertMemberSlot(w: CityWorld, citizenId: number, slot: MemberTripSlot): void {
  const rest = memberSlots(w, citizenId).filter((s) => s.memberId !== slot.memberId);
  writeSlots(w, citizenId, [...rest, slot].sort((a, b) => a.memberId - b.memberId));
}

/** Removes the member's slot — the member is home. */
export function dropMemberSlot(w: CityWorld, citizenId: number, memberId: number): void {
  writeSlots(
    w,
    citizenId,
    memberSlots(w, citizenId).filter((s) => s.memberId !== memberId),
  );
}

/** A school walker arrived; move the member's slot to its next stage. */
export function handleSchoolArrival(
  sim: CitySim,
  w: CityWorld,
  path: PedestrianPathComponent,
): void {
  const citizen = w.getComponent(path.citizen, 'citizen');
  if (
    !citizen ||
    !w.isAlive(path.citizen) ||
    w.getEntityGeneration(path.citizen) !== path.citizenGen
  ) {
    return;
  }
  if (path.outbound) {
    const departedAt =
      memberSlots(w, path.citizen).find((s) => s.memberId === path.memberId)?.waitUntil ?? w.tick;
    const dawdle = memberOffset(
      sim.seed,
      path.citizen,
      path.citizenGen,
      citizen.home,
      path.memberId,
      SCHOOL_RETURN_SPREAD_TICKS,
    );
    upsertMemberSlot(w, path.citizen, {
      memberId: path.memberId,
      phase: 'atPlace',
      place: path.destination,
      placeGen: path.destinationGen,
      purpose: 'school',
      // Max, not the raw dismissal: a walk long enough to land after the bell
      // means the school day is already over, so the child turns around now
      // rather than dwelling until tomorrow's bell — ~27 hours, through the
      // night. The outbound slot's `waitUntil` is the tick they set out on.
      waitUntil: Math.max(w.tick, schoolDismissalAfter(departedAt, dawdle)),
    });
  } else {
    dropMemberSlot(w, path.citizen, path.memberId);
  }
}

/** A school walker was cancelled (severed route, dead endpoint): child goes home. */
export function handleSchoolCancel(
  w: CityWorld,
  path: PedestrianPathComponent,
  disconnected: boolean,
): void {
  if (
    !w.isAlive(path.citizen) ||
    w.getEntityGeneration(path.citizen) !== path.citizenGen
  ) {
    return;
  }
  if (disconnected) {
    w.setState(
      'disconnectedTrips',
      ((w.getState('disconnectedTrips') as number | undefined) ?? 0) + 1,
    );
    markStranded(w, path.citizen);
  }
  dropMemberSlot(w, path.citizen, path.memberId);
}
