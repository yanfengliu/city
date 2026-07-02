import { buildingCapacity } from './buildings';
import { DEMAND_VACANCY_CAP } from './constants/zoning';
import type { CitySim } from './city';
import type { CityWorld } from './types';

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * RCI demand + population stats. All terms are in citizen entities
 * (households); the UI multiplies population for display. Abandoned buildings
 * are excluded from every aggregate.
 */
export function demandSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    let jobsTotal = 0;
    let jobsFilled = 0;
    let housingCapacity = 0;
    let residents = 0;
    let commercialSlots = 0;
    let industrialSlots = 0;

    for (const id of w.query('building')) {
      const building = w.getComponent(id, 'building');
      if (!building || building.abandoned) continue;
      const capacity = buildingCapacity(building);
      if (building.zone === 'R') {
        housingCapacity += capacity;
        residents += building.residents;
      } else {
        jobsTotal += capacity;
        jobsFilled += building.jobsFilled;
        if (building.zone === 'C') commercialSlots += capacity;
        else industrialSlots += capacity;
      }
    }

    // query() returns a generator — materialize before counting.
    const citizens = [...w.query('citizen')].length;
    const unemployed = citizens - jobsFilled;
    // Cap the vacancy penalty: overzoning R shouldn't bury demand so deep
    // that the move-in trickle can never refill a crashed town.
    const vacancy = Math.min(housingCapacity - residents, DEMAND_VACANCY_CAP);

    const taxPenalty = sim.scoreInputs.taxDemandPenalty;
    w.setState('demand', {
      r: clamp((0.8 * (jobsTotal - jobsFilled) + 4 - 0.5 * vacancy) / 16) - taxPenalty('R'),
      c: clamp((0.3 * citizens - commercialSlots) / 10) - taxPenalty('C'),
      i: clamp((1.2 * unemployed + 0.09 * citizens - 0.4 * industrialSlots) / 13) - taxPenalty('I'),
    });
    w.setState('population', citizens);
  };
}
