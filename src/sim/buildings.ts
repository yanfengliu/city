import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import {
  ABANDON_EVALS,
  ABANDON_SCORE,
  CAPACITY_PER_CELL,
  GROWTH_ATTEMPTS,
  INDUSTRIAL_LAND_VALUE_WEIGHT,
  INDUSTRIAL_SCORE_BASE,
  LEVEL2_SCORE,
  LEVEL3_SCORE,
  LEVEL_UP_EVALS,
  MAX_LEVEL,
  RECOVER_EVALS,
  RESIDENTIAL_LAND_VALUE_WEIGHT,
  UTILITY_ABANDON_EVALS,
} from './constants/zoning';
import { cellIndex, inBounds } from './grid';
import { schoolingCurrent } from './traffic/schools';
import type { CitySim } from './city';
import type { BuildingComponent, CityWorld, DemandState, ZoneType } from './types';

const ZONE_ORDER: ZoneType[] = ['R', 'C', 'I'];

export function buildingCapacity(building: BuildingComponent): number {
  return CAPACITY_PER_CELL[building.zone][building.level - 1] * building.w * building.h;
}

export function footprintCells(x: number, y: number, w: number, h: number): number[] {
  const cells: number[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) cells.push(cellIndex(x + dx, y + dy));
  }
  return cells;
}

function cellBuildable(sim: CitySim, x: number, y: number, zone: ZoneType): boolean {
  if (!inBounds(x, y, GRID_WIDTH, GRID_HEIGHT)) return false;
  const i = cellIndex(x, y);
  return (
    sim.terrain.water[i] === 0 &&
    !sim.roadCells.has(i) &&
    !sim.occupiedCells.has(i) &&
    sim.zoneCells.get(i) === zone
  );
}

function roadAdjacent(sim: CitySim, cells: number[]): boolean {
  for (const i of cells) {
    const x = i % GRID_WIDTH;
    const y = Math.floor(i / GRID_WIDTH);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (inBounds(nx, ny, GRID_WIDTH, GRID_HEIGHT) && sim.roadCells.has(cellIndex(nx, ny)))
        return true;
    }
  }
  return false;
}

function spawnBuilding(
  sim: CitySim,
  w: CityWorld,
  x: number,
  y: number,
  zone: ZoneType,
  rubble: ReadonlySet<number>,
): void {
  // Prefer a 2×2 footprint anchored top-left; fall back to 1×1.
  let width = 2;
  let height = 2;
  let cells = [
    cellIndex(x, y),
    cellIndex(x + 1, y),
    cellIndex(x, y + 1),
    cellIndex(x + 1, y + 1),
  ];
  const fits2x2 =
    cellBuildable(sim, x + 1, y, zone) &&
    cellBuildable(sim, x, y + 1, zone) &&
    cellBuildable(sim, x + 1, y + 1, zone) &&
    !cells.some((cell) => rubble.has(cell));
  if (!fits2x2) {
    width = 1;
    height = 1;
    cells = [cellIndex(x, y)];
  }

  const entity = w.createEntity();
  w.setPosition(entity, { x, y });
  w.addComponent(entity, 'building', {
    zone,
    level: 1,
    w: width,
    h: height,
    residents: 0,
    jobsFilled: 0,
    abandoned: false,
    upEvals: 0,
    badEvals: 0,
    badUtilityEvals: 0,
    recoverEvals: 0,
    // True at spawn so pre-first-flood-fill buildings don't flash icons.
    powered: true,
    watered: true,
  });
  for (const cell of cells) sim.occupiedCells.set(cell, entity);
  w.emit('buildingGrown', { entity, zone });
}

/** Grows buildings on zoned, road-adjacent cells while demand is positive. */
export function growthSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const demand = w.getState('demand') as DemandState | undefined;
    if (!demand) return;
    const demandOf: Record<ZoneType, number> = { R: demand.r, C: demand.c, I: demand.i };

    // Rubble (freshly bulldozed cells): blocked from regrowth until expiry.
    const rubbleState = (w.getState('regrowthBlock') as Record<string, number> | undefined) ?? {};
    const rubble = new Set<number>();
    let pruned = false;
    const kept: Record<string, number> = {};
    for (const [key, until] of Object.entries(rubbleState)) {
      if (until > w.tick) {
        rubble.add(Number(key));
        kept[key] = until;
      } else {
        pruned = true;
      }
    }
    if (pruned) {
      if (Object.keys(kept).length === 0) w.deleteState('regrowthBlock');
      else w.setState('regrowthBlock', kept);
    }

    for (const zone of ZONE_ORDER) {
      if (demandOf[zone] <= 0) continue;
      // Candidate anchors, canonically sorted for replay determinism.
      const candidates = [...sim.zoneCells.entries()]
        .filter(([i, z]) => z === zone && !sim.occupiedCells.has(i))
        .map(([i]) => i)
        .sort((a, b) => a - b);
      for (let attempt = 0; attempt < GROWTH_ATTEMPTS && candidates.length > 0; attempt++) {
        const pick = Math.floor(w.random() * candidates.length);
        const anchor = candidates[pick];
        const x = anchor % GRID_WIDTH;
        const y = Math.floor(anchor / GRID_WIDTH);
        if (
          cellBuildable(sim, x, y, zone) &&
          !rubble.has(anchor) &&
          roadAdjacent(sim, [anchor])
        ) {
          spawnBuilding(sim, w, x, y, zone, rubble);
        }
        candidates.splice(pick, 1);
      }
    }
  };
}

/** Evicts every citizen whose home is the given building (they leave the city). */
export function evictCitizens(w: CityWorld, building: number): void {
  for (const id of [...w.query('citizen')].sort((a, b) => a - b)) {
    const citizen = w.getComponent(id, 'citizen');
    if (!citizen || citizen.home !== building) continue;
    // Leaving citizens free their job slot.
    if (citizen.work !== null && w.isAlive(citizen.work)) {
      const workplace = citizen.work;
      const job = w.getComponent(workplace, 'building');
      if (job && job.jobsFilled > 0) {
        w.patchComponent(workplace, 'building', (b) => {
          b.jobsFilled -= 1;
        });
      }
    }
    w.destroyEntity(id);
  }
  const data = w.getComponent(building, 'building');
  if (data && data.residents !== 0) {
    w.patchComponent(building, 'building', (b) => {
      b.residents = 0;
    });
  }
}

/** Points one covered civic need adds to a building's desirability score. */
export const COVERAGE_SCORE_PER_NEED = 8;
/** Points connected power AND water add. Missing either forfeits the whole bonus. */
export const UTILITY_SCORE_BONUS = 10;

/**
 * Every term of one building's desirability score, in the sim's own arithmetic.
 * `levelSystem` and the inspector both read THIS — a panel that recomputed the
 * score itself would drift from the rule that actually levels and abandons
 * buildings the first time either side was tuned.
 */
export interface BuildingScore {
  score: number;
  utilitiesOk: boolean;
  landValue: number;
  /** Distinct civic needs covering the anchor cell (0..5). */
  coverageCount: number;
  /** Points contributed by that coverage. */
  coverage: number;
  utilityBonus: number;
  /** Subtracted for R/C; industrial is scored on a flat base instead. */
  taxPenalty: number;
  /** Flat industrial base, 0 for R/C. */
  base: number;
  /** Weight applied to land value for this zone. */
  landValueWeight: number;
}

export function buildingScore(
  sim: CitySim,
  entity: number,
  building: BuildingComponent,
  position: { x: number; y: number },
): BuildingScore {
  const inputs = sim.scoreInputs;
  const utilitiesOk = inputs.powered(entity) && inputs.watered(entity);
  const landValue = inputs.landValueAt(position.x, position.y);
  const coverageCount = inputs.coverageCount(position.x, position.y);
  const coverage = COVERAGE_SCORE_PER_NEED * coverageCount;
  const utilityBonus = utilitiesOk ? UTILITY_SCORE_BONUS : 0;
  // Industrial couples weakly to land value (it tanks its own neighborhood
  // via pollution) and gets a flat base instead.
  const industrial = building.zone === 'I';
  const taxPenalty = industrial ? 0 : inputs.taxPenalty(building.zone);
  const score = industrial
    ? INDUSTRIAL_LAND_VALUE_WEIGHT * landValue +
      coverage +
      utilityBonus +
      INDUSTRIAL_SCORE_BASE
    : RESIDENTIAL_LAND_VALUE_WEIGHT * landValue +
      coverage +
      utilityBonus -
      taxPenalty;
  return {
    score,
    utilitiesOk,
    landValue,
    coverageCount,
    coverage,
    utilityBonus,
    taxPenalty,
    base: industrial ? INDUSTRIAL_SCORE_BASE : 0,
    landValueWeight: industrial
      ? INDUSTRIAL_LAND_VALUE_WEIGHT
      : RESIDENTIAL_LAND_VALUE_WEIGHT,
  };
}

/**
 * The level 2 -> 3 gate beyond score: a school covering this cell that children
 * actually reach (D3). Levels 1 and 2 are ungated, so this reads true there.
 */
export function buildingEducationOk(
  sim: CitySim,
  building: BuildingComponent,
  position: { x: number; y: number },
  tick: number,
): boolean {
  return (
    building.level < 2 ||
    (sim.scoreInputs.educated(position.x, position.y) &&
      schoolingCurrent(building, tick))
  );
}

/** The score a building must reach to reach its next level, or null at max. */
export function nextLevelScore(level: number): number | null {
  if (level >= MAX_LEVEL) return null;
  return level === 1 ? LEVEL2_SCORE : LEVEL3_SCORE;
}

/**
 * Level/abandonment state machine. Score inputs come from sim.scoreInputs so
 * later phases (land value, services, utilities) plug in without rewiring.
 */
export function levelSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    for (const id of [...w.query('building', 'position')].sort((a, b) => a - b)) {
      const building = w.getComponent(id, 'building');
      const position = w.getComponent(id, 'position');
      if (!building || !position) continue;
      const { score, utilitiesOk } = buildingScore(sim, id, building, position);

      if (building.abandoned) {
        // "Healthy" is the exact complement of abandonment.
        if (score >= ABANDON_SCORE && utilitiesOk) {
          if (building.recoverEvals + 1 >= RECOVER_EVALS) {
            w.patchComponent(id, 'building', (b) => {
              b.abandoned = false;
              b.level = 1;
              b.recoverEvals = 0;
              b.badEvals = 0;
              b.badUtilityEvals = 0;
              b.upEvals = 0;
            });
            w.emit('buildingRecovered', { entity: id });
          } else {
            w.patchComponent(id, 'building', (b) => {
              b.recoverEvals += 1;
            });
          }
        } else if (building.recoverEvals !== 0) {
          w.patchComponent(id, 'building', (b) => {
            b.recoverEvals = 0;
          });
        }
        continue;
      }

      const scoreBad = score < ABANDON_SCORE;
      const utilitiesBad = !utilitiesOk;
      if (scoreBad || utilitiesBad) {
        // Missing utilities strip the +10 utility bonus, depressing the score;
        // don't let that masquerade as a bad *location* and trip the fast (8s)
        // score path. While utilities are missing, only the longer utility
        // grace can abandon — the score path resumes once power/water connect
        // (and the +10 bonus lifts a merely-depressed score back over the line).
        const abandonNow =
          (scoreBad && !utilitiesBad && building.badEvals + 1 >= ABANDON_EVALS) ||
          (utilitiesBad && building.badUtilityEvals + 1 >= UTILITY_ABANDON_EVALS);
        if (abandonNow) {
          w.patchComponent(id, 'building', (b) => {
            b.abandoned = true;
            b.badEvals = 0;
            b.badUtilityEvals = 0;
            b.upEvals = 0;
            b.recoverEvals = 0;
          });
          evictCitizens(w, id);
          w.emit('buildingAbandoned', { entity: id });
        } else {
          w.patchComponent(id, 'building', (b) => {
            if (scoreBad) b.badEvals += 1;
            if (utilitiesBad) b.badUtilityEvals += 1;
          });
        }
        continue;
      }

      // Utilities are OK on this path (we passed the fault guard above), so the
      // utility-abandon streak must clear — otherwise a building that regains
      // power near the end of its grace would abandon on the very next flicker
      // (e.g. brownout on an undersized plant) instead of getting a fresh grace.
      if (building.badUtilityEvals !== 0) {
        w.patchComponent(id, 'building', (b) => {
          b.badUtilityEvals = 0;
        });
      }

      const nextScore = nextLevelScore(building.level);
      // Coverage alone was the old gate. D3 adds the other half: a school that
      // no child actually reaches teaches nobody, which is precisely the case a
      // coverage overlay cannot see (it is unaware of roads). Homes with nobody
      // of school age are stamped current by the morning scan, so this reads
      // one uniform field rather than asking who lives here.
      const educationOk = buildingEducationOk(sim, building, position, w.tick);
      if (nextScore !== null && score >= nextScore && educationOk) {
        if (building.upEvals + 1 >= LEVEL_UP_EVALS) {
          w.patchComponent(id, 'building', (b) => {
            b.level += 1;
            b.upEvals = 0;
          });
        } else {
          w.patchComponent(id, 'building', (b) => {
            b.upEvals += 1;
          });
        }
      } else if (building.upEvals !== 0 || building.badEvals !== 0) {
        w.patchComponent(id, 'building', (b) => {
          b.upEvals = 0;
          b.badEvals = 0;
        });
      }
    }
  };
}

/** Rebuilds the occupancy map (cell → building entity) after snapshot load. */
export function refreshOccupancy(sim: CitySim): void {
  const occupied = new Map<number, number>();
  for (const id of sim.world.query('building', 'position')) {
    const building = sim.world.getComponent(id, 'building');
    const position = sim.world.getComponent(id, 'position');
    if (!building || !position) continue;
    for (const cell of footprintCells(position.x, position.y, building.w, building.h)) {
      occupied.set(cell, id);
    }
  }
  sim.occupiedCells = occupied;
}
