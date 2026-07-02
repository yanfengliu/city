import { EMPLOYMENT_ASSIGNMENTS_PER_RUN } from './constants/traffic';
import { buildingCapacity } from './buildings';
import { buildingAccessNode } from './traffic/pathing';
import type { CitySim } from './city';
import type { CityWorld } from './types';

/**
 * Clears the work assignment of every citizen employed at the given building
 * (used when a workplace is bulldozed or abandons). Citizens mid-commute snap
 * back to 'home' phase; their vehicle despawns via the liveness check in the
 * vehicle system.
 */
export function unassignWorkers(w: CityWorld, building: number): void {
  for (const id of [...w.query('citizen')].sort((a, b) => a - b)) {
    const citizen = w.getComponent(id, 'citizen');
    if (!citizen || citizen.work !== building) continue;
    w.patchComponent(id, 'citizen', (c) => {
      c.work = null;
      c.phase = 'home';
    });
  }
  const data = w.getComponent(building, 'building');
  if (data && data.jobsFilled !== 0) {
    w.patchComponent(building, 'building', (b) => {
      b.jobsFilled = 0;
    });
  }
}

/**
 * Assigns unemployed citizens to the nearest REACHABLE workplace with free
 * job slots: the workplace's road-graph access node must share a connected
 * component with the home's, so citizens never take jobs their commute could
 * not route to (homes or jobs without road access are skipped).
 */
export function employmentSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const openJobs: Array<{
      id: number;
      x: number;
      y: number;
      free: number;
      component: number;
    }> = [];
    for (const id of [...w.query('building', 'position')].sort((a, b) => a - b)) {
      const building = w.getComponent(id, 'building');
      const position = w.getComponent(id, 'position');
      if (!building || !position || building.zone === 'R' || building.abandoned) continue;
      const free = buildingCapacity(building) - building.jobsFilled;
      if (free <= 0) continue;
      const node = buildingAccessNode(sim, id);
      if (node === null) continue;
      const component = sim.roadGraph.cellComponent.get(node);
      if (component === undefined) continue;
      openJobs.push({ id, x: position.x, y: position.y, free, component });
    }
    if (openJobs.length === 0) return;

    let assigned = 0;
    for (const id of [...w.query('citizen')].sort((a, b) => a - b)) {
      if (assigned >= EMPLOYMENT_ASSIGNMENTS_PER_RUN) break;
      const citizen = w.getComponent(id, 'citizen');
      if (!citizen || citizen.work !== null) continue;
      const home = w.getComponent(citizen.home, 'position');
      if (!home) continue;
      const homeNode = buildingAccessNode(sim, citizen.home);
      if (homeNode === null) continue;
      const homeComponent = sim.roadGraph.cellComponent.get(homeNode);
      if (homeComponent === undefined) continue;

      let best: (typeof openJobs)[number] | null = null;
      let bestDistance = Infinity;
      for (const job of openJobs) {
        if (job.free <= 0 || job.component !== homeComponent) continue;
        const distance = Math.abs(job.x - home.x) + Math.abs(job.y - home.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = job;
        }
      }
      if (!best) continue;

      const workplace = best;
      w.patchComponent(id, 'citizen', (c) => {
        c.work = workplace.id;
      });
      w.patchComponent(workplace.id, 'building', (b) => {
        b.jobsFilled += 1;
      });
      workplace.free -= 1;
      assigned++;
    }
  };
}
