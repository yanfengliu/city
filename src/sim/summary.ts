import { getTreasury } from './city';
import { PEOPLE_PER_CITIZEN } from './constants/zoning';
import type { CityWorld, DemandState, ZoneType } from './types';

/** Compact, browser-free snapshot of a city read straight from a `World` — the
 * headless counterpart of the client's `render_game_to_text`, used to inspect
 * ground-truth state at any replayed tick (see docs/harness.md). */
export interface SimSummary {
  tick: number;
  /** People = citizen households × PEOPLE_PER_CITIZEN. */
  population: number;
  treasury: number;
  demand: DemandState;
  buildings: {
    total: number;
    byZone: Record<ZoneType, number>;
    /** Non-abandoned counts at level 1, 2, 3. */
    byLevel: [number, number, number];
    abandoned: number;
  };
  citizens: number;
  employed: number;
  vehicles: number;
  pedestrians: number;
  completedShoppingTrips: number;
  roadCells: number;
  structures: number;
  disconnectedTrips: number;
}

export function simSummary(world: CityWorld): SimSummary {
  let total = 0;
  let abandoned = 0;
  const byZone: Record<ZoneType, number> = { R: 0, C: 0, I: 0 };
  const byLevel: [number, number, number] = [0, 0, 0];
  for (const id of world.query('building')) {
    const b = world.getComponent(id, 'building');
    if (!b) continue;
    total++;
    if (b.abandoned) {
      abandoned++;
      continue;
    }
    byZone[b.zone]++;
    byLevel[Math.min(Math.max(b.level, 1), 3) - 1]++;
  }

  let citizens = 0;
  let employed = 0;
  for (const id of world.query('citizen')) {
    const c = world.getComponent(id, 'citizen');
    if (!c) continue;
    citizens++;
    if (c.work !== null && c.work !== undefined) employed++;
  }

  return {
    tick: world.tick,
    population: citizens * PEOPLE_PER_CITIZEN,
    treasury: getTreasury(world),
    demand: (world.getState('demand') as DemandState | undefined) ?? { r: 0, c: 0, i: 0 },
    buildings: { total, byZone, byLevel, abandoned },
    citizens,
    employed,
    vehicles: [...world.query('vehicle')].length,
    pedestrians: [...world.query('pedestrian')].length,
    completedShoppingTrips:
      (world.getState('completedShoppingTrips') as number | undefined) ?? 0,
    roadCells: [...world.query('roadCell')].length,
    structures: [...world.query('structure')].length,
    disconnectedTrips: (world.getState('disconnectedTrips') as number | undefined) ?? 0,
  };
}

/** One-line rendering for replay-inspect logs. */
export function summaryLine(s: SimSummary): string {
  const b = s.buildings;
  const d = s.demand;
  const r2 = (v: number): string => (Math.round(v * 100) / 100).toString();
  return (
    `t${s.tick} pop${s.population} $${Math.round(s.treasury)} ` +
    `bld${b.total}(R${b.byZone.R}/C${b.byZone.C}/I${b.byZone.I} L${b.byLevel.join('/')} ab${b.abandoned}) ` +
    `emp${s.employed}/${s.citizens} veh${s.vehicles} walk${s.pedestrians} shop${s.completedShoppingTrips} road${s.roadCells} svc${s.structures} ` +
    `dem[r${r2(d.r)} c${r2(d.c)} i${r2(d.i)}] disc${s.disconnectedTrips}`
  );
}
