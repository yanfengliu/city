import { GRID_WIDTH } from '../constants/map';
import {
  CONGESTION_SLOWDOWN_PER_BUCKET,
  HOME_COOLDOWN_BASE,
  HOME_COOLDOWN_VARIANCE,
  MIN_SPEED_FACTOR,
  SIGNAL_MIN_APPROACHES,
  VEHICLE_BASE_SPEED,
  VEHICLE_EDGE_HOLD_T,
  VEHICLE_HEADWAY_CELLS,
  VEHICLE_STOP_LINE_CELLS,
  WORK_WAIT_BASE,
  WORK_WAIT_VARIANCE,
} from '../constants/traffic';
import { signalPhase } from '../../protocol/signal-phase';
import { pickFreeTimeActivity } from '../activities';
import { profileForCitizen, travellerForActivity } from '../citizen-profile';
import type { CitySim } from '../city';
import type { RoadEdge } from '../road/road-graph';
import type { CitizenComponent, CityWorld, VehicleComponent, VehicleLeg } from '../types';

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

/** A lane is one traversal direction of one edge (right-hand carriageway). */
export function laneKey(leg: VehicleLeg): number {
  return leg.edge * 2 + (leg.reverse ? 1 : 0);
}

/** Progress bound a car may not pass while its junction signal shows red. */
export function stopLineT(edge: RoadEdge): number {
  return Math.max(0, 1 - VEHICLE_STOP_LINE_CELLS / edge.length);
}

/**
 * True when the node this leg is driving toward runs a signal that is not
 * green for the leg's approach axis. Two-approach nodes (bends, dead ends)
 * carry no signal; single-cell edges cannot orient an approach and pass free.
 */
export function redForApproach(sim: CitySim, tick: number, leg: VehicleLeg, edge: RoadEdge): boolean {
  const cells = edge.cells;
  if (cells.length < 2) return false;
  const nodeCell = leg.reverse ? cells[0] : cells[cells.length - 1];
  const incident = sim.roadGraph.nodes.get(nodeCell);
  if (!incident || incident.length < SIGNAL_MIN_APPROACHES) return false;
  const prevCell = leg.reverse ? cells[1] : cells[cells.length - 2];
  const axis = prevCell % GRID_WIDTH === nodeCell % GRID_WIDTH ? 'ns' : 'ew';
  return signalPhase(tick, nodeCell) !== axis;
}

/**
 * True when a car may not enter this lane because its entry stretch is
 * occupied. Uses pre-move tail positions (cars only move forward, so the
 * check is conservative) plus same-tick entrants, which hold the slot at once.
 */
function entryBlocked(
  sim: CitySim,
  leg: VehicleLeg,
  preMinT: ReadonlyMap<number, number>,
  entered: ReadonlySet<number>,
): boolean {
  const key = laneKey(leg);
  if (entered.has(key)) return true;
  const tail = preMinT.get(key);
  if (tail === undefined) return false;
  const length = sim.roadGraph.edges[leg.edge].length;
  return tail < (VEHICLE_BASE_SPEED + VEHICLE_HEADWAY_CELLS) / length;
}

/** True when a fresh spawn at t = 0 would land inside an existing car's gap. */
export function spawnBlocked(sim: CitySim, w: CityWorld, leg: VehicleLeg): boolean {
  const length = sim.roadGraph.edges[leg.edge].length;
  const window = (VEHICLE_BASE_SPEED + VEHICLE_HEADWAY_CELLS) / length;
  for (const id of w.query('vehicle')) {
    const data = w.getComponent(id, 'vehicle');
    if (!data) continue;
    const current = data.legs[data.legIndex];
    if (current.edge === leg.edge && current.reverse === leg.reverse && data.t < window) {
      return true;
    }
  }
  return false;
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
  const profile = profileForCitizen(sim, data.citizen, citizen);
  if (data.toWork && validOutboundDestination(w, citizen, data)) {
    w.patchComponent(data.citizen, 'citizen', (c) => {
      c.phase = 'atWork';
      c.waitUntil = w.tick + WORK_WAIT_BASE + Math.floor(w.random() * WORK_WAIT_VARIANCE);
      c.travellerMemberId = travellerForActivity(profile, 'work');
    });
  } else if (data.toWork) {
    // A stale/recycled destination never becomes a valid work arrival. Keep a
    // newer assignment intact, but return the citizen to the work stage.
    w.patchComponent(data.citizen, 'citizen', (c) => {
      c.phase = 'home';
      c.waitUntil = w.tick + HOME_COOLDOWN_BASE + Math.floor(w.random() * HOME_COOLDOWN_VARIANCE);
      c.nextActivity = 'work';
      c.travellerMemberId = travellerForActivity(profile, 'work');
    });
  } else {
    w.patchComponent(data.citizen, 'citizen', (c) => {
      c.phase = 'home';
      c.waitUntil = w.tick + HOME_COOLDOWN_BASE + Math.floor(w.random() * HOME_COOLDOWN_VARIANCE);
      // Home from work — the evening is theirs to plan.
      c.nextActivity = pickFreeTimeActivity(w, citizen, profile);
      c.travellerMemberId = travellerForActivity(profile, c.nextActivity);
    });
  }
}

interface LaneEntry {
  id: number;
  data: VehicleComponent;
}

/**
 * Advances every vehicle along its legs; runs every tick.
 *
 * Micro rules (docs/design/simulation-realism.md T1) on top of the macro
 * bucket speed: cars in one lane keep a headway gap and never pass each
 * other; a car whose next lane's entry stretch is occupied waits at the edge
 * boundary; a car approaching a signaled junction on red holds at the stop
 * line (unless it is arriving, or already past the line when the light
 * turned). Lanes process in deterministic key order, leader first, so every
 * follower clamps against its leader's post-move position.
 */
export function vehicleSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const lanes = new Map<number, LaneEntry[]>();
    const preMinT = new Map<number, number>();
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

      const key = laneKey(data.legs[data.legIndex]);
      const list = lanes.get(key);
      if (list) list.push({ id, data });
      else lanes.set(key, [{ id, data }]);
      const min = preMinT.get(key);
      if (min === undefined || data.t < min) preMinT.set(key, data.t);
    }

    /** Lanes that received a car this tick — their entry slot is taken. */
    const entered = new Set<number>();

    for (const key of [...lanes.keys()].sort((a, b) => a - b)) {
      const queue = lanes.get(key);
      if (!queue) continue;
      queue.sort((m, n) => n.data.t - m.data.t || m.id - n.id);

      /** Post-move progress of the car ahead in this lane (null at the front). */
      let leaderT: number | null = null;
      for (const { id, data } of queue) {
        const leg = data.legs[data.legIndex];
        const edge = sim.roadGraph.edges[leg.edge];
        const bucket = sim.edgeBuckets.get(leg.edge) ?? 0;
        const speed =
          VEHICLE_BASE_SPEED *
          Math.max(MIN_SPEED_FACTOR, 1 - CONGESTION_SLOWDOWN_PER_BUCKET * bucket);
        let t = data.t + speed / edge.length;
        const finalLeg = data.legIndex + 1 >= data.legs.length;

        if (!finalLeg && data.t <= stopLineT(edge) && redForApproach(sim, w.tick, leg, edge)) {
          t = Math.min(t, stopLineT(edge));
        }
        if (!finalLeg && t >= 1 && entryBlocked(sim, data.legs[data.legIndex + 1], preMinT, entered)) {
          t = Math.min(t, VEHICLE_EDGE_HOLD_T);
        }
        if (leaderT !== null) {
          t = Math.min(t, leaderT - VEHICLE_HEADWAY_CELLS / edge.length);
        }
        // Clamps yield, never reverse: a car with less than its gap keeps
        // still while the car ahead pulls away.
        t = Math.max(t, data.t);

        let legIndex = data.legIndex;
        if (t >= 1) {
          if (finalLeg) {
            arrive(sim, w, id, { ...data, legIndex, t });
            leaderT = null; // the lane ahead of the next car is now open
            continue;
          }
          releaseEdge(sim, leg.edge);
          legIndex++;
          const nextLeg = data.legs[legIndex];
          const nextEdge = sim.roadGraph.edges[nextLeg.edge];
          sim.edgeCounts.set(nextLeg.edge, (sim.edgeCounts.get(nextLeg.edge) ?? 0) + 1);
          t = (t - 1) * (edge.length / nextEdge.length);
          entered.add(laneKey(nextLeg));
          leaderT = null; // this car left the lane; the next one leads
        } else {
          leaderT = t;
        }

        const current = data.legs[legIndex];
        const cells = sim.roadGraph.edges[current.edge].cells;
        const along = Math.min(t, 0.999);
        const cellPos = current.reverse
          ? cells[cells.length - 1 - Math.floor(along * (cells.length - 1))]
          : cells[Math.floor(along * (cells.length - 1))];

        w.setComponent(id, 'vehicle', { ...data, legIndex, t });
        w.setPosition(id, { x: cellPos % GRID_WIDTH, y: Math.floor(cellPos / GRID_WIDTH) });
      }
    }
  };
}
