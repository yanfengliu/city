import { GRID_WIDTH } from '../constants/map';
import {
  HOME_COOLDOWN_BASE,
  HOME_COOLDOWN_VARIANCE,
  PEDESTRIAN_BASE_SPEED,
  PEDESTRIAN_MIN_GAP_CELLS,
  SHOP_WAIT_BASE,
  SHOP_WAIT_VARIANCE,
  TRIP_RETRY_TICKS,
  WORK_WAIT_BASE,
  WORK_WAIT_VARIANCE,
} from '../constants/traffic';
import { LEISURE_WAIT_BASE, LEISURE_WAIT_VARIANCE } from '../constants/activities';
import { CITIZEN_PRIMARY_MEMBER_ID } from '../constants/citizens';
import { pickFreeTimeActivity } from '../activities';
import { profileForCitizen, travellerForActivity } from '../citizen-profile';
import { markStranded } from '../happiness';
import type { CitySim } from '../city';
import type {
  CityWorld,
  PedestrianComponent,
  PedestrianPathComponent,
  PedestrianPurpose,
} from '../types';

export function validShop(w: CityWorld, id: number, generation?: number): boolean {
  if (!w.isAlive(id)) return false;
  if (generation !== undefined && w.getEntityGeneration(id) !== generation) return false;
  const building = w.getComponent(id, 'building');
  return (
    building?.zone === 'C' &&
    !building.abandoned &&
    building.jobsFilled > 0 &&
    building.powered &&
    building.watered
  );
}

/**
 * A park is open whenever it still stands: it has no staff to lose, no power to
 * cut, and nothing to abandon — the one thing that ends a visit is the player
 * bulldozing it.
 */
export function validPark(w: CityWorld, id: number, generation?: number): boolean {
  if (!w.isAlive(id)) return false;
  if (generation !== undefined && w.getEntityGeneration(id) !== generation) return false;
  return w.getComponent(id, 'structure')?.type === 'park';
}

export function spawnPedestrian(
  w: CityWorld,
  citizen: number,
  cells: number[],
  destination: number,
  purpose: PedestrianPurpose,
  outbound: boolean,
): number {
  const walker = w.createEntity();
  const start = cells[0];
  w.setPosition(walker, { x: start % GRID_WIDTH, y: Math.floor(start / GRID_WIDTH) });
  w.addComponent(walker, 'pedestrianPath', {
    citizen,
    citizenGen: w.getEntityGeneration(citizen),
    memberId:
      w.getComponent(citizen, 'citizen')?.travellerMemberId ?? CITIZEN_PRIMARY_MEMBER_ID,
    cells,
    destination,
    destinationGen: w.getEntityGeneration(destination),
    purpose,
    outbound,
  });
  w.addComponent(walker, 'pedestrian', { segmentIndex: 0, t: 0 });
  return walker;
}

function randomWait(w: CityWorld, base: number, variance: number): number {
  return w.tick + base + Math.floor(w.random() * variance);
}

function destinationValid(w: CityWorld, path: PedestrianPathComponent): boolean {
  if (!w.isAlive(path.destination)) return false;
  if (w.getEntityGeneration(path.destination) !== path.destinationGen) return false;
  const citizen = w.getComponent(path.citizen, 'citizen');
  if (!citizen) return false;
  // An outbound outing ends at a shop or at a park; only the shop case is a
  // building, so this arm is checked before anything reads `building`.
  if (path.outbound && path.purpose === 'shopping') {
    if (citizen.shop !== path.destination || citizen.shopGen !== path.destinationGen) return false;
    return (
      validPark(w, path.destination, path.destinationGen) ||
      validShop(w, path.destination, path.destinationGen)
    );
  }
  const building = w.getComponent(path.destination, 'building');
  if (!building || building.abandoned) return false;
  if (!path.outbound) return citizen.home === path.destination && building.zone === 'R';
  return citizen.work === path.destination && building.zone !== 'R';
}

/** Cancels one walker and restores its citizen to the logical trip origin. */
export function cancelPedestrian(
  w: CityWorld,
  walker: number,
  path: PedestrianPathComponent,
  disconnected: boolean,
): void {
  w.destroyEntity(walker);
  const citizen = w.getComponent(path.citizen, 'citizen');
  if (
    !citizen ||
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
  w.patchComponent(path.citizen, 'citizen', (data) => {
    if (path.outbound) {
      data.phase = 'home';
      if (path.purpose === 'shopping') {
        // `nextActivity` still names the outing (a shopping run or an evening
        // out), so leaving it alone retries the same plan rather than flattening
        // every cancelled outing into a shopping trip.
        data.shop = null;
        data.shopGen = null;
      } else {
        data.nextActivity = 'work';
      }
    } else {
      data.phase = path.purpose === 'shopping' ? 'atShop' : 'atWork';
    }
    data.waitUntil = w.tick + TRIP_RETRY_TICKS;
  });
}

function arrive(
  sim: CitySim,
  w: CityWorld,
  walker: number,
  path: PedestrianPathComponent,
): void {
  w.destroyEntity(walker);
  const component = w.getComponent(path.citizen, 'citizen');
  const owner =
    component !== undefined &&
    w.isAlive(path.citizen) &&
    w.getEntityGeneration(path.citizen) === path.citizenGen
      ? component
      : undefined;
  if (!owner || !destinationValid(w, path)) {
    if (owner) {
      w.patchComponent(path.citizen, 'citizen', (data) => {
        data.phase = 'home';
        data.waitUntil = w.tick + TRIP_RETRY_TICKS;
        if (path.purpose === 'shopping') {
          data.shop = null;
          data.shopGen = null;
          // Outbound, the outing is still the plan and `nextActivity` already
          // names it; inbound, the outing is over — back to the work half.
          if (!path.outbound) data.nextActivity = 'work';
        }
      });
    }
    return;
  }

  const profile = profileForCitizen(sim, path.citizen, owner);
  const outingIsLeisure = owner.nextActivity === 'leisure';
  w.patchComponent(path.citizen, 'citizen', (data) => {
    data.travellerMemberId ??= travellerForActivity(profile, owner.nextActivity ?? 'work');
    if (path.outbound && path.purpose === 'shopping') {
      data.phase = 'atShop';
      data.waitUntil = outingIsLeisure
        ? randomWait(w, LEISURE_WAIT_BASE, LEISURE_WAIT_VARIANCE)
        : randomWait(w, SHOP_WAIT_BASE, SHOP_WAIT_VARIANCE);
    } else if (path.outbound) {
      data.phase = 'atWork';
      data.waitUntil = randomWait(w, WORK_WAIT_BASE, WORK_WAIT_VARIANCE);
    } else {
      data.phase = 'home';
      data.waitUntil = randomWait(w, HOME_COOLDOWN_BASE, HOME_COOLDOWN_VARIANCE);
      if (path.purpose === 'shopping') {
        data.nextActivity = 'work';
        data.shop = null;
        data.shopGen = null;
        data.travellerMemberId = travellerForActivity(profile, 'work');
      } else {
        // Home from work — the evening is theirs to plan.
        data.nextActivity = pickFreeTimeActivity(w, owner, profile);
        data.travellerMemberId = travellerForActivity(profile, data.nextActivity);
      }
    }
  });
  // An evening at the park is an outing, not a sale: only an arrival at a
  // commercial building books retail. destinationValid has already run, so a
  // shopping-purpose destination is either a live shop or a live park.
  if (path.outbound && path.purpose === 'shopping' && w.getComponent(path.destination, 'building')) {
    w.setState(
      'pendingRetailVisits',
      ((w.getState('pendingRetailVisits') as number | undefined) ?? 0) + 1,
    );
    w.setState(
      'completedShoppingTrips',
      ((w.getState('completedShoppingTrips') as number | undefined) ?? 0) + 1,
    );
  }
}

interface WalkerEntry {
  id: number;
  path: PedestrianPathComponent;
  motion: PedestrianComponent;
}

/**
 * Advances active walkers one exact road-cell segment at a time. Walkers on
 * the same directed segment form a lane (opposing flows walk separate curb
 * lanes renderer-side): a follower may never pass its leader and keeps a
 * personal-space gap, clamped forward-only so nobody teleports backward
 * (docs/design/simulation-realism.md T1). Segments are unit cells, so
 * `segmentIndex + t` is a global progress scale shared across a whole path.
 */
export function pedestrianSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const lanes = new Map<string, WalkerEntry[]>();
    for (const id of [...w.query('pedestrianPath', 'pedestrian')].sort((a, b) => a - b)) {
      const path = w.getComponent(id, 'pedestrianPath');
      const motion = w.getComponent(id, 'pedestrian');
      if (!path || !motion) continue;
      const citizen = w.getComponent(path.citizen, 'citizen');
      if (
        !citizen ||
        !w.isAlive(path.citizen) ||
        w.getEntityGeneration(path.citizen) !== path.citizenGen
      ) {
        w.destroyEntity(id);
        continue;
      }
      const from = path.cells[motion.segmentIndex];
      const to = path.cells[motion.segmentIndex + 1] ?? from;
      const key = `${from}>${to}`;
      const list = lanes.get(key);
      const entry: WalkerEntry = { id, path, motion };
      if (list) list.push(entry);
      else lanes.set(key, [entry]);
    }

    for (const key of [...lanes.keys()].sort()) {
      const queue = lanes.get(key);
      if (!queue) continue;
      queue.sort(
        (m, n) =>
          n.motion.segmentIndex + n.motion.t - (m.motion.segmentIndex + m.motion.t) ||
          m.id - n.id,
      );

      /** Post-move global progress of the walker ahead on this lane. */
      let leaderProgress: number | null = null;
      for (const { id, path, motion } of queue) {
        const current = motion.segmentIndex + motion.t;
        let progress = current + PEDESTRIAN_BASE_SPEED;
        if (leaderProgress !== null) {
          progress = Math.min(progress, leaderProgress - PEDESTRIAN_MIN_GAP_CELLS);
        }
        progress = Math.max(progress, current);

        const segmentIndex = Math.floor(progress);
        const t = progress - segmentIndex;
        if (path.cells.length <= 1 || segmentIndex + 1 >= path.cells.length) {
          arrive(sim, w, id, path);
          leaderProgress = null; // the lane ahead of the next walker is open
          continue;
        }
        leaderProgress = progress;
        const cell = path.cells[segmentIndex];
        w.setPosition(id, { x: cell % GRID_WIDTH, y: Math.floor(cell / GRID_WIDTH) });
        w.setComponent(id, 'pedestrian', { segmentIndex, t });
      }
    }
  };
}
