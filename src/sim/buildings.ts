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

function spawnBuilding(sim: CitySim, w: CityWorld, x: number, y: number, zone: ZoneType): void {
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
    cellBuildable(sim, x + 1, y + 1, zone);
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
        if (cellBuildable(sim, x, y, zone) && roadAdjacent(sim, [anchor])) {
          spawnBuilding(sim, w, x, y, zone);
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
      const inputs = sim.scoreInputs;
      const utilitiesOk = inputs.powered(id) && inputs.watered(id);
      const landValue = inputs.landValueAt(position.x, position.y);
      const coverage = 8 * inputs.coverageCount(position.x, position.y);
      const utilityBonus = utilitiesOk ? 10 : 0;
      // Industrial couples weakly to land value (it tanks its own neighborhood
      // via pollution) and gets a flat base instead.
      const score =
        building.zone === 'I'
          ? INDUSTRIAL_LAND_VALUE_WEIGHT * landValue +
            coverage +
            utilityBonus +
            INDUSTRIAL_SCORE_BASE
          : RESIDENTIAL_LAND_VALUE_WEIGHT * landValue +
            coverage +
            utilityBonus -
            inputs.taxPenalty(building.zone);

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
        const abandonNow =
          (scoreBad && building.badEvals + 1 >= ABANDON_EVALS) ||
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

      const nextLevelScore = building.level === 1 ? LEVEL2_SCORE : LEVEL3_SCORE;
      const educationOk =
        building.level < 2 || inputs.educated(position.x, position.y);
      if (building.level < MAX_LEVEL && score >= nextLevelScore && educationOk) {
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
