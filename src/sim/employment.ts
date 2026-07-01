import { EMPLOYMENT_ASSIGNMENTS_PER_RUN } from './constants/traffic';
import { buildingCapacity } from './buildings';
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

/** Assigns unemployed citizens to the nearest workplace with free job slots. */
export function employmentSystem(_sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const openJobs: Array<{ id: number; x: number; y: number; free: number }> = [];
    for (const id of [...w.query('building', 'position')].sort((a, b) => a - b)) {
      const building = w.getComponent(id, 'building');
      const position = w.getComponent(id, 'position');
      if (!building || !position || building.zone === 'R' || building.abandoned) continue;
      const free = buildingCapacity(building) - building.jobsFilled;
      if (free > 0) openJobs.push({ id, x: position.x, y: position.y, free });
    }
    if (openJobs.length === 0) return;

    let assigned = 0;
    for (const id of [...w.query('citizen')].sort((a, b) => a - b)) {
      if (assigned >= EMPLOYMENT_ASSIGNMENTS_PER_RUN) break;
      const citizen = w.getComponent(id, 'citizen');
      if (!citizen || citizen.work !== null) continue;
      const home = w.getComponent(citizen.home, 'position');
      if (!home) continue;

      let best: (typeof openJobs)[number] | null = null;
      let bestDistance = Infinity;
      for (const job of openJobs) {
        if (job.free <= 0) continue;
        const distance = Math.abs(job.x - home.x) + Math.abs(job.y - home.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = job;
        }
      }
      if (!best) break;

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
