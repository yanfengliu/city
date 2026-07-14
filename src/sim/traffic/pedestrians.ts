import { GRID_WIDTH } from '../constants/map';
import {
  HOME_COOLDOWN_BASE,
  HOME_COOLDOWN_VARIANCE,
  PEDESTRIAN_BASE_SPEED,
  SHOP_WAIT_BASE,
  SHOP_WAIT_VARIANCE,
  TRIP_RETRY_TICKS,
  WORK_WAIT_BASE,
  WORK_WAIT_VARIANCE,
} from '../constants/traffic';
import type { CitySim } from '../city';
import type {
  CityWorld,
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
  const building = w.getComponent(path.destination, 'building');
  if (!citizen || !building || building.abandoned) return false;
  if (!path.outbound) return citizen.home === path.destination && building.zone === 'R';
  if (path.purpose === 'shopping') {
    return (
      citizen.shop === path.destination &&
      citizen.shopGen === path.destinationGen &&
      validShop(w, path.destination, path.destinationGen)
    );
  }
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
  }
  w.patchComponent(path.citizen, 'citizen', (data) => {
    if (path.outbound) {
      data.phase = 'home';
      data.nextActivity = path.purpose === 'shopping' ? 'shop' : 'work';
      if (path.purpose === 'shopping') {
        data.shop = null;
        data.shopGen = null;
      }
    } else {
      data.phase = path.purpose === 'shopping' ? 'atShop' : 'atWork';
    }
    data.waitUntil = w.tick + TRIP_RETRY_TICKS;
  });
}

function arrive(w: CityWorld, walker: number, path: PedestrianPathComponent): void {
  w.destroyEntity(walker);
  const citizen = w.getComponent(path.citizen, 'citizen');
  const ownerCurrent =
    citizen !== undefined &&
    w.isAlive(path.citizen) &&
    w.getEntityGeneration(path.citizen) === path.citizenGen;
  if (!ownerCurrent || !destinationValid(w, path)) {
    if (ownerCurrent) {
      w.patchComponent(path.citizen, 'citizen', (data) => {
        data.phase = 'home';
        data.waitUntil = w.tick + TRIP_RETRY_TICKS;
        if (path.purpose === 'shopping') {
          data.nextActivity = 'shop';
          data.shop = null;
          data.shopGen = null;
        }
      });
    }
    return;
  }

  w.patchComponent(path.citizen, 'citizen', (data) => {
    if (path.outbound && path.purpose === 'shopping') {
      data.phase = 'atShop';
      data.waitUntil = randomWait(w, SHOP_WAIT_BASE, SHOP_WAIT_VARIANCE);
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
      } else {
        data.nextActivity = 'shop';
      }
    }
  });
  if (path.outbound && path.purpose === 'shopping') {
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

/** Advances active walkers one exact road-cell segment at a time. */
export function pedestrianSystem(_sim: CitySim): (w: CityWorld) => void {
  return (w) => {
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

      let segmentIndex = motion.segmentIndex;
      let t = motion.t + PEDESTRIAN_BASE_SPEED;
      while (t >= 1 && segmentIndex + 1 < path.cells.length) {
        t -= 1;
        segmentIndex++;
      }
      if (path.cells.length <= 1 || segmentIndex + 1 >= path.cells.length) {
        arrive(w, id, path);
        continue;
      }
      const cell = path.cells[segmentIndex];
      w.setPosition(id, { x: cell % GRID_WIDTH, y: Math.floor(cell / GRID_WIDTH) });
      w.setComponent(id, 'pedestrian', { segmentIndex, t });
    }
  };
}
