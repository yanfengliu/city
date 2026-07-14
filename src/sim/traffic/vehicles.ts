import { GRID_WIDTH } from '../constants/map';
import {
  CONGESTION_SLOWDOWN_PER_BUCKET,
  HOME_COOLDOWN_BASE,
  HOME_COOLDOWN_VARIANCE,
  MIN_SPEED_FACTOR,
  VEHICLE_BASE_SPEED,
  WORK_WAIT_BASE,
  WORK_WAIT_VARIANCE,
} from '../constants/traffic';
import type { CitySim } from '../city';
import type { CitizenComponent, CityWorld, VehicleComponent } from '../types';

function releaseEdge(sim: CitySim, edge: number): void {
  const count = sim.edgeCounts.get(edge) ?? 0;
  if (count <= 1) sim.edgeCounts.delete(edge);
  else sim.edgeCounts.set(edge, count - 1);
}

/** Removes a vehicle entity and its edge-count contribution. */
export function despawnVehicle(sim: CitySim, w: CityWorld, id: number, data: VehicleComponent): void {
  if (data.legIndex < data.legs.length) releaseEdge(sim, data.legs[data.legIndex].edge);
  w.destroyEntity(id);
}

function validOutboundDestination(
  w: CityWorld,
  citizen: CitizenComponent,
  data: VehicleComponent,
): boolean {
  const work = citizen.work;
  if (work === null || !w.isAlive(work)) return false;
  const building = w.getComponent(work, 'building');
  if (!building || building.abandoned || building.zone === 'R') return false;

  // Legacy saves cannot prove which assignment an in-flight vehicle targeted,
  // so missing or partially populated identity metadata fails closed.
  if (data.destination === undefined || data.destinationGen === undefined) return false;
  return (
    work === data.destination &&
    w.getEntityGeneration(data.destination) === data.destinationGen
  );
}

function arrive(sim: CitySim, w: CityWorld, id: number, data: VehicleComponent): void {
  releaseEdge(sim, data.legs[data.legs.length - 1].edge);
  w.destroyEntity(id);
  const citizen = w.getComponent(data.citizen, 'citizen');
  if (!citizen) return;
  if (data.toWork && validOutboundDestination(w, citizen, data)) {
    w.patchComponent(data.citizen, 'citizen', (c) => {
      c.phase = 'atWork';
      c.waitUntil = w.tick + WORK_WAIT_BASE + Math.floor(w.random() * WORK_WAIT_VARIANCE);
    });
  } else if (data.toWork) {
    // A stale/recycled destination never becomes a valid work arrival. Keep a
    // newer assignment intact, but return the citizen to the work stage.
    w.patchComponent(data.citizen, 'citizen', (c) => {
      c.phase = 'home';
      c.waitUntil = w.tick + HOME_COOLDOWN_BASE + Math.floor(w.random() * HOME_COOLDOWN_VARIANCE);
      c.nextActivity = 'work';
    });
  } else {
    w.patchComponent(data.citizen, 'citizen', (c) => {
      c.phase = 'home';
      c.waitUntil = w.tick + HOME_COOLDOWN_BASE + Math.floor(w.random() * HOME_COOLDOWN_VARIANCE);
      c.nextActivity = 'shop';
    });
  }
}

/** Advances every vehicle along its legs; runs every tick. */
export function vehicleSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    for (const id of [...w.query('vehicle')].sort((a, b) => a - b)) {
      const data = w.getComponent(id, 'vehicle');
      if (!data) continue;

      // Owner gone (evicted) → cull. Generation check guards against the
      // engine recycling the destroyed owner's id for a new citizen.
      const citizen = w.getComponent(data.citizen, 'citizen');
      if (
        !citizen ||
        !w.isAlive(data.citizen) ||
        w.getEntityGeneration(data.citizen) !== data.citizenGen
      ) {
        despawnVehicle(sim, w, id, data);
        continue;
      }

      const leg = data.legs[data.legIndex];
      const edge = sim.roadGraph.edges[leg.edge];
      const bucket = sim.edgeBuckets.get(leg.edge) ?? 0;
      const speed =
        VEHICLE_BASE_SPEED *
        Math.max(MIN_SPEED_FACTOR, 1 - CONGESTION_SLOWDOWN_PER_BUCKET * bucket);
      let t = data.t + speed / edge.length;
      let legIndex = data.legIndex;
      let currentLength = edge.length;

      while (t >= 1) {
        if (legIndex + 1 >= data.legs.length) {
          arrive(sim, w, id, { ...data, legIndex, t });
          t = -1; // sentinel: vehicle is gone
          break;
        }
        releaseEdge(sim, data.legs[legIndex].edge);
        legIndex++;
        const nextEdge = sim.roadGraph.edges[data.legs[legIndex].edge];
        sim.edgeCounts.set(
          data.legs[legIndex].edge,
          (sim.edgeCounts.get(data.legs[legIndex].edge) ?? 0) + 1,
        );
        t = (t - 1) * (currentLength / nextEdge.length);
        currentLength = nextEdge.length;
      }
      if (t < 0) continue;

      const current = data.legs[legIndex];
      const cells = sim.roadGraph.edges[current.edge].cells;
      const along = Math.min(t, 0.999);
      const cellPos = current.reverse
        ? cells[cells.length - 1 - Math.floor(along * (cells.length - 1))]
        : cells[Math.floor(along * (cells.length - 1))];

      w.setComponent(id, 'vehicle', { ...data, legIndex, t });
      w.setPosition(id, { x: cellPos % GRID_WIDTH, y: Math.floor(cellPos / GRID_WIDTH) });
    }
  };
}
