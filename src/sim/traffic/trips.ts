import { MAX_VEHICLES, TRIPS_PER_RUN } from '../constants/traffic';
import { buildingAccessNode, findNodePath, nodePathToLegs } from './pathing';
import { GRID_WIDTH } from '../constants/map';
import type { CitySim } from '../city';
import type { CityWorld, VehicleLeg } from '../types';

function countDisconnected(w: CityWorld): void {
  w.setState('disconnectedTrips', ((w.getState('disconnectedTrips') as number) ?? 0) + 1);
}

/** Spawns a vehicle entity for a citizen at the first cell of its route. */
export function spawnVehicle(
  sim: CitySim,
  w: CityWorld,
  citizen: number,
  legs: VehicleLeg[],
  toWork: boolean,
): void {
  const vehicle = w.createEntity();
  const firstEdge = sim.roadGraph.edges[legs[0].edge];
  const startCell = legs[0].reverse ? firstEdge.cells[firstEdge.cells.length - 1] : firstEdge.cells[0];
  w.setPosition(vehicle, { x: startCell % GRID_WIDTH, y: Math.floor(startCell / GRID_WIDTH) });
  w.addComponent(vehicle, 'vehicle', { citizen, legs, legIndex: 0, t: 0, toWork });
  sim.edgeCounts.set(legs[0].edge, (sim.edgeCounts.get(legs[0].edge) ?? 0) + 1);
}

/**
 * Starts commute trips for employed citizens whose cooldown has expired.
 * Candidate selection rotates deterministically via the tripCursor world
 * state so every citizen eventually gets a turn under the per-run cap.
 */
export function tripSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    let vehicleCount = [...w.query('vehicle')].length;
    if (vehicleCount >= MAX_VEHICLES) return;

    const eligible: number[] = [];
    for (const id of [...w.query('citizen')].sort((a, b) => a - b)) {
      const citizen = w.getComponent(id, 'citizen');
      if (!citizen || citizen.work === null) continue;
      if (citizen.phase === 'home' || citizen.phase === 'atWork') {
        if (citizen.waitUntil <= w.tick) eligible.push(id);
      }
    }
    if (eligible.length === 0) return;

    const cursor = ((w.getState('tripCursor') as number) ?? 0) % eligible.length;
    for (let n = 0; n < Math.min(TRIPS_PER_RUN, eligible.length); n++) {
      if (vehicleCount >= MAX_VEHICLES) break;
      const id = eligible[(cursor + n) % eligible.length];
      const citizen = w.getComponent(id, 'citizen');
      if (!citizen || citizen.work === null) continue;

      const toWork = citizen.phase === 'home';
      const fromBuilding = toWork ? citizen.home : citizen.work;
      const toBuilding = toWork ? citizen.work : citizen.home;
      const from = buildingAccessNode(sim, fromBuilding);
      const to = buildingAccessNode(sim, toBuilding);
      const nodes = from !== null && to !== null ? findNodePath(sim, from, to) : null;
      const legs = nodes ? nodePathToLegs(sim, nodes) : null;

      if (!legs || legs.length === 0) {
        if (nodes && nodes.length === 1) {
          // Same access node — treat as an instant (walking) trip.
          w.patchComponent(id, 'citizen', (c) => {
            c.phase = toWork ? 'atWork' : 'home';
          });
          continue;
        }
        countDisconnected(w);
        // Back off before retrying so unroutable citizens don't spin.
        w.patchComponent(id, 'citizen', (c) => {
          c.waitUntil = w.tick + 128;
        });
        continue;
      }

      w.patchComponent(id, 'citizen', (c) => {
        c.phase = toWork ? 'toWork' : 'toHome';
      });
      spawnVehicle(sim, w, id, legs, toWork);
      vehicleCount++;
    }
    w.setState('tripCursor', cursor + Math.min(TRIPS_PER_RUN, eligible.length));
  };
}
