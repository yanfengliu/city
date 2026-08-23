import {
  buildingCapacity,
  buildingEducationOk,
  buildingScore,
  footprintCells,
  nextLevelScore,
  utilityAbandonThreshold,
  type BuildingScore,
} from './buildings';
import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import {
  SERVICE_BENEFIT_GROUPS,
  SERVICE_COST,
  SERVICE_FOOTPRINT,
  SERVICE_RADIUS,
  SERVICE_UPKEEP,
} from './constants/services';
import {
  COAL_PLANT_POLLUTION,
  POWER_PLANT_CAPACITY,
  POWER_PLANT_COST,
  POWER_PLANT_FOOTPRINT,
  POWER_PLANT_UPKEEP,
  UTILITY_BRIDGE_RADIUS,
  UTILITY_DEMAND_PER_CELL_LEVEL,
  WATER_PUMP_CAPACITY,
  WATER_PUMP_COST,
  WATER_PUMP_UPKEEP,
} from './constants/utilities';
import {
  ABANDON_EVALS,
  ABANDON_SCORE,
  DEFAULT_TAX_RATE,
  LEVEL_UP_EVALS,
  MAX_LEVEL,
  PEOPLE_PER_CITIZEN,
  RECOVER_EVALS,
} from './constants/zoning';
import { utilityTotals } from './utilities';
import { coversCell } from './services';
import { schoolingCurrent } from './traffic/schools';
import { cellIndex, inBounds } from './grid';
import type { CitySim } from './city';
import type {
  BuildingComponent,
  CityWorld,
  PowerPlantKind,
  ServiceType,
  TaxRates,
  ZoneType,
} from './types';

/**
 * Everything a "what is this and how is it doing?" panel needs about one
 * placed thing, answered on demand for a single entity. Like the citizen
 * query it is never streamed, so the cost is paid only while a panel is open.
 *
 * Every derived number here reads the SIM's own rule (`buildingScore`,
 * `buildingEducationOk`, `utilityTotals`) rather than restating it, so the
 * panel cannot quietly disagree with the system that levels, abandons, and
 * powers the building it is describing.
 */

/** Shared identity and footprint for every inspectable placement. */
export interface BuildingDetailBase {
  entity: number;
  generation: number;
  /** Top-left anchor of the footprint. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sim tick the detail was read at. */
  tick: number;
}

/** One civic need at this location — the same grouping happiness credits. */
export interface CoverageNeed {
  name: string;
  covered: boolean;
}

/**
 * Why this building is not levelling up right now, named in `levelSystem`'s own
 * branch order. `utilities` exists because the level branch is UNREACHABLE
 * while power or water is missing — `levelSystem` `continue`s out of the whole
 * evaluation first — so a panel that only compared score against the threshold
 * would show a full progress bar on a building that can never advance.
 */
export type GrowthBlocker =
  | 'none'
  | 'abandoned'
  | 'maxLevel'
  | 'utilities'
  | 'score'
  | 'education';

/** Every term of the desirability score plus the streaks it feeds. */
export interface GrowableScoreDetail {
  value: number;
  landValue: number;
  landValueWeight: number;
  coverage: number;
  coverageCount: number;
  utilityBonus: number;
  taxPenalty: number;
  base: number;
  abandonAt: number;
  /** Score needed for the next level; null at max level. */
  nextLevelAt: number | null;
  upEvals: number;
  levelUpEvals: number;
  badEvals: number;
  abandonEvals: number;
  badUtilityEvals: number;
  utilityAbandonEvals: number;
  recoverEvals: number;
  recoverEvalsNeeded: number;
}

/** A grown R/C/I building. */
export interface GrowableBuildingDetail extends BuildingDetailBase {
  kind: 'growable';
  zone: ZoneType;
  level: number;
  maxLevel: number;
  abandoned: boolean;
  /** Household entities housed (R); each is PEOPLE_PER_CITIZEN people. */
  households: number;
  people: number;
  peopleCapacity: number;
  jobsFilled: number;
  jobCapacity: number;
  /** Households of this home currently out of the house (R). */
  householdsOut: number;
  /** Households WALKING here for an outing (C and green venues). */
  inbound: number;
  /** Households already here on an outing — arrived, not yet heading home. */
  present: number;
  score: GrowableScoreDetail;
  /** Why it is not levelling up, from the level system's own branch order. */
  growthBlocker: GrowthBlocker;
  needs: CoverageNeed[];
  pollution: number;
  noise: number;
  powered: boolean;
  watered: boolean;
  /** Power/water units this building draws from its network. */
  utilityDemand: number;
  /** True when the level 2 -> 3 education gate is satisfied (or not yet due). */
  educationOk: boolean;
  schoolCovered: boolean;
  /** A resident child actually reached school recently (D3). */
  schoolingCurrent: boolean;
  taxRate: number;
  roadConnected: boolean;
}

/** A player-placed civic service. */
export interface ServiceBuildingDetail extends BuildingDetailBase {
  kind: 'service';
  service: ServiceType;
  radius: number;
  cost: number;
  upkeep: number;
  /** Non-abandoned buildings whose anchor lies in the coverage square. */
  buildingsCovered: number;
  /** People living in those buildings. */
  peopleCovered: number;
  /** School only: children currently walking to, or sitting in, this school. */
  attendance: { walking: number; present: number } | null;
  /** Park/garden only: households walking here, and households already here. */
  visitors: { inbound: number; present: number } | null;
}

/** City-wide installed capacity against total draw, for utility panels. */
export interface UtilityCityTotals {
  supply: number;
  demand: number;
}

export interface PowerPlantDetail extends BuildingDetailBase {
  kind: 'powerPlant';
  plant: PowerPlantKind;
  capacity: number;
  cost: number;
  upkeep: number;
  /** Pollution emitted at the anchor block each cadence (0 for wind). */
  pollution: number;
  bridgeRadius: number;
  city: UtilityCityTotals;
}

export interface WaterPumpDetail extends BuildingDetailBase {
  kind: 'waterPump';
  capacity: number;
  cost: number;
  upkeep: number;
  bridgeRadius: number;
  city: UtilityCityTotals;
}

export type BuildingDetail =
  | GrowableBuildingDetail
  | ServiceBuildingDetail
  | PowerPlantDetail
  | WaterPumpDetail;

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
      if (inBounds(nx, ny, GRID_WIDTH, GRID_HEIGHT) && sim.roadCells.has(cellIndex(nx, ny))) {
        return true;
      }
    }
  }
  return false;
}

/** Civic needs at the anchor, in the canonical benefit-group order. */
function needsAt(sim: CitySim, x: number, y: number): CoverageNeed[] {
  return SERVICE_BENEFIT_GROUPS.map((group) => ({
    name: group.name,
    covered: group.services.some((service) => sim.fields.coverage[service].getAt(x, y) > 0),
  }));
}

const RATE_KEY: Record<ZoneType, keyof TaxRates> = { R: 'r', C: 'c', I: 'i' };

function taxRateFor(world: CityWorld, zone: ZoneType): number {
  const rates = world.getState('taxRates') as TaxRates | undefined;
  return rates ? rates[RATE_KEY[zone]] : DEFAULT_TAX_RATE;
}

/**
 * Whether this household's outing still points at `entity` at THIS incarnation.
 * `shop` is set on departure and cleared only on arriving home, so the phase is
 * the only thing that separates walking-here from dwelling from walking-home.
 */
function outingTargets(
  citizen: { shop?: number | null; shopGen?: number | null },
  entity: number,
  generation: number,
): boolean {
  if (citizen.shop !== entity) return false;
  return (
    citizen.shopGen === undefined ||
    citizen.shopGen === null ||
    citizen.shopGen === generation
  );
}

/** Households at home vs. out, and outings aimed at this building. */
function citizenTraffic(
  world: CityWorld,
  entity: number,
): { householdsOut: number; inbound: number; present: number } {
  let householdsOut = 0;
  let inbound = 0;
  let present = 0;
  const generation = world.getEntityGeneration(entity);
  for (const id of world.query('citizen')) {
    const citizen = world.getComponent(id, 'citizen');
    if (!citizen) continue;
    if (citizen.home === entity && citizen.phase !== 'home') householdsOut += 1;
    if (!outingTargets(citizen, entity, generation)) continue;
    // 'toShop' is on the way; 'atShop' has arrived; 'toHome' still carries the
    // venue id all the way home and is neither.
    if (citizen.phase === 'toShop') inbound += 1;
    else if (citizen.phase === 'atShop') present += 1;
  }
  return { householdsOut, inbound, present };
}

/**
 * Retraces `levelSystem`'s branches in the same order, so the panel's answer to
 * "why isn't this growing?" is the system's answer and not a second opinion.
 */
function growthBlockerOf(
  building: BuildingComponent,
  score: BuildingScore,
  educationOk: boolean,
): GrowthBlocker {
  if (building.abandoned) return 'abandoned';
  // levelSystem's fault guard: either problem skips the level evaluation
  // entirely, so no amount of desirability advances the building.
  if (!score.utilitiesOk) return 'utilities';
  if (score.score < ABANDON_SCORE) return 'score';
  const next = nextLevelScore(building.level);
  if (next === null) return 'maxLevel';
  if (score.score < next) return 'score';
  return educationOk ? 'none' : 'education';
}

function growableDetail(
  sim: CitySim,
  entity: number,
  building: BuildingComponent,
  position: { x: number; y: number },
): GrowableBuildingDetail {
  const { world } = sim;
  const cells = footprintCells(position.x, position.y, building.w, building.h);
  const score = buildingScore(sim, entity, building, position);
  // A level outside 1..MAX_LEVEL would index past CAPACITY_PER_CELL and read
  // NaN into every occupancy line; a corrupt level is worth reporting as a
  // clamp, never as "Room for NaN people".
  const capacity = buildingCapacity({
    ...building,
    level: Math.min(Math.max(building.level, 1), MAX_LEVEL),
  });
  const traffic = citizenTraffic(world, entity);
  const educationOk = buildingEducationOk(sim, building, position, world.tick);
  return {
    kind: 'growable',
    entity,
    generation: world.getEntityGeneration(entity),
    x: position.x,
    y: position.y,
    w: building.w,
    h: building.h,
    tick: world.tick,
    zone: building.zone,
    level: building.level,
    maxLevel: MAX_LEVEL,
    abandoned: building.abandoned,
    households: building.residents,
    people: building.residents * PEOPLE_PER_CITIZEN,
    peopleCapacity: capacity * PEOPLE_PER_CITIZEN,
    jobsFilled: building.jobsFilled,
    jobCapacity: capacity,
    householdsOut: traffic.householdsOut,
    inbound: traffic.inbound,
    present: traffic.present,
    score: {
      value: score.score,
      landValue: score.landValue,
      landValueWeight: score.landValueWeight,
      coverage: score.coverage,
      coverageCount: score.coverageCount,
      utilityBonus: score.utilityBonus,
      taxPenalty: score.taxPenalty,
      base: score.base,
      abandonAt: ABANDON_SCORE,
      nextLevelAt: nextLevelScore(building.level),
      upEvals: building.upEvals,
      levelUpEvals: LEVEL_UP_EVALS,
      badEvals: building.badEvals,
      abandonEvals: ABANDON_EVALS,
      badUtilityEvals: building.badUtilityEvals,
      utilityAbandonEvals: utilityAbandonThreshold(entity),
      recoverEvals: building.recoverEvals,
      recoverEvalsNeeded: RECOVER_EVALS,
    },
    growthBlocker: growthBlockerOf(building, score, educationOk),
    needs: needsAt(sim, position.x, position.y),
    pollution: sim.fields.pollution.getAt(position.x, position.y),
    noise: sim.fields.noise.getAt(position.x, position.y),
    powered: sim.scoreInputs.powered(entity),
    watered: sim.scoreInputs.watered(entity),
    utilityDemand: UTILITY_DEMAND_PER_CELL_LEVEL * building.level * building.w * building.h,
    educationOk,
    schoolCovered: sim.fields.coverage.school.getAt(position.x, position.y) > 0,
    schoolingCurrent: schoolingCurrent(building, world.tick),
    taxRate: taxRateFor(world, building.zone),
    roadConnected: roadAdjacent(sim, cells),
  };
}

/** Buildings and people inside a service's Chebyshev coverage square. */
function coverageReach(
  world: CityWorld,
  x: number,
  y: number,
  radius: number,
): { buildingsCovered: number; peopleCovered: number } {
  let buildingsCovered = 0;
  let peopleCovered = 0;
  for (const id of world.query('building', 'position')) {
    const building = world.getComponent(id, 'building');
    const position = world.getComponent(id, 'position');
    if (!building || !position || building.abandoned) continue;
    // The SIM's own block-granular rule, not an exact Chebyshev test: a
    // stricter test here would report "serving 0 buildings" about homes whose
    // own panel shows the service's ✅ (and whose desirability it is raising).
    if (!coversCell(x, y, radius, position.x, position.y)) continue;
    buildingsCovered += 1;
    peopleCovered += building.residents * PEOPLE_PER_CITIZEN;
  }
  return { buildingsCovered, peopleCovered };
}

/** Children on their way to, or sitting in, this school right now (D2). */
function schoolAttendance(
  world: CityWorld,
  entity: number,
): { walking: number; present: number } {
  const generation = world.getEntityGeneration(entity);
  let walking = 0;
  let present = 0;
  for (const id of world.query('memberTrip')) {
    const trip = world.getComponent(id, 'memberTrip');
    if (!trip) continue;
    for (const slot of trip.slots) {
      if (slot.place !== entity || slot.placeGen !== generation) continue;
      if (slot.phase === 'atPlace') present += 1;
      else if (slot.phase === 'toPlace') walking += 1;
    }
  }
  return { walking, present };
}

/** Households walking to this venue, and households already at it. */
function venueVisitors(
  world: CityWorld,
  entity: number,
): { inbound: number; present: number } {
  const generation = world.getEntityGeneration(entity);
  let inbound = 0;
  let present = 0;
  for (const id of world.query('citizen')) {
    const citizen = world.getComponent(id, 'citizen');
    if (!citizen || !outingTargets(citizen, entity, generation)) continue;
    if (citizen.phase === 'toShop') inbound += 1;
    else if (citizen.phase === 'atShop') present += 1;
  }
  return { inbound, present };
}

function serviceDetail(
  sim: CitySim,
  entity: number,
  service: ServiceType,
  position: { x: number; y: number },
): ServiceBuildingDetail {
  const { world } = sim;
  const radius = SERVICE_RADIUS[service];
  const reach = coverageReach(world, position.x, position.y, radius);
  const green = service === 'park' || service === 'garden';
  return {
    kind: 'service',
    entity,
    generation: world.getEntityGeneration(entity),
    x: position.x,
    y: position.y,
    w: SERVICE_FOOTPRINT,
    h: SERVICE_FOOTPRINT,
    tick: world.tick,
    service,
    radius,
    cost: SERVICE_COST[service],
    upkeep: SERVICE_UPKEEP[service],
    buildingsCovered: reach.buildingsCovered,
    peopleCovered: reach.peopleCovered,
    attendance: service === 'school' ? schoolAttendance(world, entity) : null,
    visitors: green ? venueVisitors(world, entity) : null,
  };
}

function powerPlantDetail(
  world: CityWorld,
  entity: number,
  kind: PowerPlantKind,
  position: { x: number; y: number },
): PowerPlantDetail {
  const side = POWER_PLANT_FOOTPRINT[kind];
  return {
    kind: 'powerPlant',
    entity,
    generation: world.getEntityGeneration(entity),
    x: position.x,
    y: position.y,
    w: side,
    h: side,
    tick: world.tick,
    plant: kind,
    capacity: POWER_PLANT_CAPACITY[kind],
    cost: POWER_PLANT_COST[kind],
    upkeep: POWER_PLANT_UPKEEP[kind],
    pollution: kind === 'coal' ? COAL_PLANT_POLLUTION : 0,
    bridgeRadius: UTILITY_BRIDGE_RADIUS,
    city: utilityTotals(world).power,
  };
}

function waterPumpDetail(
  world: CityWorld,
  entity: number,
  position: { x: number; y: number },
): WaterPumpDetail {
  return {
    kind: 'waterPump',
    entity,
    generation: world.getEntityGeneration(entity),
    x: position.x,
    y: position.y,
    w: 1,
    h: 1,
    tick: world.tick,
    capacity: WATER_PUMP_CAPACITY,
    cost: WATER_PUMP_COST,
    upkeep: WATER_PUMP_UPKEEP,
    bridgeRadius: UTILITY_BRIDGE_RADIUS,
    city: utilityTotals(world).water,
  };
}

/**
 * One placement's full detail, or null when the entity is not something the
 * inspector describes. Pair a null with `buildingDetailProblem` for wording
 * that names the entity and what it actually is.
 */
export function buildingDetail(sim: CitySim, entity: number): BuildingDetail | null {
  const { world } = sim;
  if (!world.isAlive(entity)) return null;
  const position = world.getComponent(entity, 'position');
  if (!position) return null;
  const building = world.getComponent(entity, 'building');
  if (building) return growableDetail(sim, entity, building, position);
  const structure = world.getComponent(entity, 'structure');
  if (structure) return serviceDetail(sim, entity, structure.type, position);
  const plant = world.getComponent(entity, 'powerPlant');
  if (plant) return powerPlantDetail(world, entity, plant.kind, position);
  if (world.getComponent(entity, 'waterPump')) return waterPumpDetail(world, entity, position);
  return null;
}

/** Player-facing reason a detail query returned nothing. */
export function buildingDetailProblem(sim: CitySim, entity: number): string | null {
  const { world } = sim;
  if (!world.isAlive(entity)) {
    return `entity ${entity} is no longer in the city — it was demolished or replaced`;
  }
  if (!world.getComponent(entity, 'position')) {
    return `entity ${entity} has no map position, so it is not a placed building`;
  }
  if (world.getComponent(entity, 'citizen')) {
    return `entity ${entity} is a household, not a building — inspect it as a person instead`;
  }
  return `entity ${entity} is not a building, service, power plant, or water pump`;
}
