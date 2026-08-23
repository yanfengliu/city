import { describe, expect, it } from 'vitest';
import { buildingDetail, buildingDetailProblem } from '../../src/sim/building-detail';
import { buildingScore } from '../../src/sim/buildings';
import { createCitySim } from '../../src/sim/city';
import { COVERAGE_BLOCK_SIZE, SERVICE_RADIUS } from '../../src/sim/constants/services';
import {
  POWER_PLANT_CAPACITY,
  WATER_PUMP_CAPACITY,
} from '../../src/sim/constants/utilities';
import {
  ABANDON_SCORE,
  LEVEL2_SCORE,
  PEOPLE_PER_CITIZEN,
} from '../../src/sim/constants/zoning';
import { SCHOOLING_FRESH_TICKS } from '../../src/sim/constants/routine';
import { utilityTotals } from '../../src/sim/utilities';
import type {
  GrowableBuildingDetail,
  PowerPlantDetail,
  ServiceBuildingDetail,
  WaterPumpDetail,
} from '../../src/sim/building-detail';
import {
  buildDistrict,
  findConnectablePumpSpot,
  findLandBlock,
  roadedSite,
  seedBuilding,
  seedCitizen,
} from './helpers';

/**
 * The inspector's contract. Its whole reason to exist is that a panel must not
 * invent a second version of a rule the sim already owns, so most of these
 * assert agreement with the sim rather than a hardcoded number.
 */

function city() {
  return createCitySim({ seed: 7, fieldsEnabled: true, utilitiesEnabled: true });
}

/**
 * The phase-4 seam: fields on, utilities off, so `powered`/`watered` read true.
 * Used where the point is a NON-utility gate — otherwise the flood-fill cuts
 * power to a town with no plant and every blocker collapses to 'utilities'.
 */
function cityWithoutUtilities() {
  return createCitySim({ seed: 7, fieldsEnabled: true, utilitiesEnabled: false });
}

/** Grows a residential district and returns one grown home. */
function grownHome(sim: ReturnType<typeof city>): number {
  const origin = findLandBlock(sim, 20, 10);
  buildDistrict(sim, 'R', origin);
  for (let i = 0; i < 400; i++) sim.world.step();
  const homes = [...sim.world.query('building')].filter(
    (id) => sim.world.getComponent(id, 'building')?.zone === 'R',
  );
  expect(homes.length).toBeGreaterThan(0);
  return homes[0];
}

function growable(sim: ReturnType<typeof city>, entity: number): GrowableBuildingDetail {
  const detail = buildingDetail(sim, entity);
  expect(detail?.kind).toBe('growable');
  return detail as GrowableBuildingDetail;
}

describe('growable building detail', () => {
  it('reports occupancy in people and every term of the sim‑s own desirability score', () => {
    const sim = city();
    const home = grownHome(sim);
    const building = sim.world.getComponent(home, 'building')!;
    const position = sim.world.getComponent(home, 'position')!;
    const expected = buildingScore(sim, home, building, position);

    const detail = growable(sim, home);

    expect(detail.zone).toBe('R');
    expect(detail.households).toBe(building.residents);
    expect(detail.people).toBe(building.residents * PEOPLE_PER_CITIZEN);
    expect(detail.peopleCapacity).toBeGreaterThanOrEqual(detail.people);
    // Not a restatement of the formula — the exact object the level system reads.
    expect(detail.score.value).toBe(expected.score);
    expect(detail.score.landValue).toBe(expected.landValue);
    expect(detail.score.coverage).toBe(expected.coverage);
    expect(detail.score.coverageCount).toBe(expected.coverageCount);
    expect(detail.score.utilityBonus).toBe(expected.utilityBonus);
    expect(detail.score.taxPenalty).toBe(expected.taxPenalty);
    expect(detail.score.abandonAt).toBe(ABANDON_SCORE);
    expect(detail.score.nextLevelAt).toBe(LEVEL2_SCORE);
    expect(detail.roadConnected).toBe(true);
    expect(detail.needs.map((need) => need.name)).toEqual([
      'fire station',
      'police station',
      'clinic',
      'school',
      'green space',
    ]);
  });

  it('counts a covering service as a met need and credits it to the score', () => {
    const sim = city();
    const origin = roadedSite(sim);
    const home = seedBuilding(sim, { x: origin.x + 1, y: origin.y + 1, zone: 'R', residents: 2 });
    const before = growable(sim, home);
    expect(before.needs.find((need) => need.name === 'fire station')?.covered).toBe(false);

    const placed = sim.world.submit('placeService', {
      service: 'fireStation',
      x: origin.x + 6,
      y: origin.y + 1,
    });
    expect(sim.lastRejection ?? 'accepted').toBe('accepted');
    expect(placed).toBe(true);
    for (let i = 0; i < 40; i++) sim.world.step();

    const after = growable(sim, home);
    expect(after.needs.find((need) => need.name === 'fire station')?.covered).toBe(true);
    expect(after.score.coverageCount).toBe(before.score.coverageCount + 1);
    expect(after.score.coverage).toBe(before.score.coverage + 8);
  });

  it('separates a missing school from a school nobody reaches at the level 2 gate', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 4, y: 4, zone: 'R', level: 2, residents: 2 });

    const noSchool = growable(sim, home);
    expect(noSchool.schoolCovered).toBe(false);
    expect(noSchool.educationOk).toBe(false);

    sim.world.runMaintenance(() => {
      sim.world.patchComponent(home, 'building', (b) => {
        b.schoolingTick = sim.world.tick;
      });
    });
    // A stamped home still needs the coverage field; the two halves are distinct.
    expect(growable(sim, home).schoolingCurrent).toBe(true);
    expect(growable(sim, home).educationOk).toBe(false);
  });

  it('reports the unsupplied streak that will eventually empty the building', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 6, y: 6, zone: 'R', residents: 1, powered: false });
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(home, 'building', (b) => {
        b.badUtilityEvals = 12;
      });
    });

    const detail = growable(sim, home);

    expect(detail.powered).toBe(false);
    expect(detail.watered).toBe(true);
    expect(detail.score.badUtilityEvals).toBe(12);
    expect(detail.score.utilityAbandonEvals).toBeGreaterThan(12);
    expect(detail.utilityDemand).toBe(1);
  });

  it('separates households out of the house from shoppers walking here and shopping here', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 8, y: 8, zone: 'R', residents: 2 });
    const shop = seedBuilding(sim, { x: 12, y: 8, zone: 'C', jobsFilled: 1 });
    const gen = sim.world.getEntityGeneration(shop);
    seedCitizen(sim, home, null, { phase: 'toShop', shop, shopGen: gen });
    seedCitizen(sim, home, null, { phase: 'atShop', shop, shopGen: gen });
    // On the way HOME from the shop: still carries `shop`, counts as neither.
    seedCitizen(sim, home, null, { phase: 'toHome', shop, shopGen: gen });
    seedCitizen(sim, home, null, { phase: 'home' });

    expect(growable(sim, home).householdsOut).toBe(3);
    const shopDetail = growable(sim, shop);
    expect(shopDetail.inbound).toBe(1);
    expect(shopDetail.present).toBe(1);
  });
});

describe('the panel agrees with the system that actually levels buildings', () => {
  /** Runs the real level system and reports what it did, next to what we said. */
  function levelAfter(sim: ReturnType<typeof city>, home: number, ticks: number) {
    const before = growable(sim, home);
    for (let i = 0; i < ticks; i++) sim.world.step();
    const building = sim.world.getComponent(home, 'building')!;
    return { before, level: building.level, upEvals: building.upEvals };
  }

  it('does not promise a level-up while the utilities gate is shut', () => {
    const sim = city();
    const origin = roadedSite(sim);
    // Every ingredient for level 2 EXCEPT power: the score is far over the bar.
    const home = seedBuilding(sim, {
      x: origin.x + 1,
      y: origin.y + 1,
      zone: 'R',
      residents: 2,
      powered: false,
    });
    const services = ['fireStation', 'police', 'clinic', 'school'] as const;
    for (let i = 0; i < services.length; i++) {
      expect(
        sim.world.submit('placeService', {
          service: services[i],
          x: origin.x + 3 + i * 2,
          y: origin.y + 1,
        }),
      ).toBe(true);
      sim.world.step();
    }
    for (let i = 0; i < 20; i++) sim.world.step();

    const run = levelAfter(sim, home, 200);

    // The score genuinely clears the level-2 bar, so this is not a weak setup.
    expect(run.before.score.value).toBeGreaterThanOrEqual(run.before.score.nextLevelAt!);
    // And the sim still refuses: the level branch is never reached.
    expect(run.level).toBe(1);
    expect(run.upEvals).toBe(0);
    // So the panel must say utilities, not "threshold met, 0 of 3 checks".
    expect(run.before.powered).toBe(false);
    expect(run.before.growthBlocker).toBe('utilities');
  });

  it('blames the score when the score is what is short', () => {
    const sim = cityWithoutUtilities();
    const origin = roadedSite(sim);
    // A bare block: supplied, but nothing covers it and land value is ordinary.
    const plain = seedBuilding(sim, { x: origin.x + 1, y: origin.y + 1, zone: 'R', residents: 1 });

    const detail = growable(sim, plain);

    expect(detail.powered).toBe(true);
    expect(detail.score.value).toBeLessThan(detail.score.nextLevelAt!);
    expect(detail.growthBlocker).toBe('score');
  });

  it('blames the school only once the score is no longer the problem', () => {
    const sim = cityWithoutUtilities();
    const origin = roadedSite(sim);
    const home = seedBuilding(sim, {
      x: origin.x + 1,
      y: origin.y + 1,
      zone: 'R',
      level: 2,
      residents: 1,
    });
    // Cover every civic need so the level-3 score bar is genuinely cleared, and
    // leave the education STAMP missing — the D3 half of the gate.
    expect(
      sim.world.submit('placeRoad', {
        ax: origin.x,
        ay: origin.y + 3,
        bx: origin.x + 10,
        by: origin.y + 3,
      }),
    ).toBe(true);
    sim.world.step();
    const services = [
      { service: 'fireStation' as const, x: origin.x + 3, y: origin.y + 1 },
      { service: 'police' as const, x: origin.x + 5, y: origin.y + 1 },
      { service: 'clinic' as const, x: origin.x + 7, y: origin.y + 1 },
      { service: 'school' as const, x: origin.x + 9, y: origin.y + 1 },
      { service: 'park' as const, x: origin.x + 1, y: origin.y + 4 },
    ];
    for (const placement of services) {
      expect(sim.world.submit('placeService', placement)).toBe(true);
      sim.world.step();
    }
    for (let i = 0; i < 40; i++) sim.world.step();
    // A STALE stamp, not a missing one: an absent `schoolingTick` reads as
    // satisfied so legacy saves never stall, which would hide this gate.
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(home, 'building', (b) => {
        b.schoolingTick = sim.world.tick - SCHOOLING_FRESH_TICKS - 1;
      });
    });

    const detail = growable(sim, home);

    expect(detail.schoolCovered).toBe(true);
    expect(detail.schoolingCurrent).toBe(false);
    expect(detail.educationOk).toBe(false);
    expect(detail.score.value).toBeGreaterThanOrEqual(detail.score.nextLevelAt!);
    expect(detail.growthBlocker).toBe('education');
  });

  it('says max level exactly when the sim has nothing left to give', () => {
    const sim = cityWithoutUtilities();
    const top = seedBuilding(sim, { x: 5, y: 5, zone: 'R', level: 3, residents: 1 });
    expect(growable(sim, top).score.nextLevelAt).toBeNull();
    // Utilities come first in levelSystem, so a supplied top-level building
    // reports maxLevel and an unsupplied one reports utilities.
    expect(growable(sim, top).growthBlocker).toBe('maxLevel');
  });
});

describe('service building detail', () => {
  it('reports its coverage square and who is inside it', () => {
    const sim = city();
    const origin = roadedSite(sim);
    seedBuilding(sim, { x: origin.x + 1, y: origin.y + 1, zone: 'R', residents: 4 });
    expect(
      sim.world.submit('placeService', { service: 'clinic', x: origin.x + 3, y: origin.y + 1 }),
    ).toBe(true);
    sim.world.step();
    const clinic = [...sim.world.query('structure')][0];

    const detail = buildingDetail(sim, clinic) as ServiceBuildingDetail;

    expect(detail.kind).toBe('service');
    expect(detail.service).toBe('clinic');
    expect(detail.radius).toBe(SERVICE_RADIUS.clinic);
    expect(detail.buildingsCovered).toBe(1);
    expect(detail.peopleCovered).toBe(4 * PEOPLE_PER_CITIZEN);
    // A clinic has neither pupils nor outings; those fields stay explicitly null.
    expect(detail.attendance).toBeNull();
    expect(detail.visitors).toBeNull();
  });

  it('counts only what is inside the radius, and skips abandoned buildings', () => {
    const sim = city();
    const origin = roadedSite(sim);
    // A garden reaches 6 cells, so the far home is deliberately outside it.
    seedBuilding(sim, { x: origin.x + 1, y: origin.y + 1, zone: 'R', residents: 2 });
    seedBuilding(sim, { x: origin.x + 2, y: origin.y + 1, zone: 'R', residents: 5, abandoned: true });
    seedBuilding(sim, { x: origin.x + 1, y: origin.y + 20, zone: 'R', residents: 9 });
    expect(
      sim.world.submit('placeService', { service: 'garden', x: origin.x + 3, y: origin.y + 1 }),
    ).toBe(true);
    sim.world.step();
    const garden = [...sim.world.query('structure')][0];

    const detail = buildingDetail(sim, garden) as ServiceBuildingDetail;

    expect(detail.radius).toBe(SERVICE_RADIUS.garden);
    // The near live home only: the abandoned neighbour and the distant home
    // are both excluded, so a big radius cannot quietly inherit the same count.
    expect(detail.buildingsCovered).toBe(1);
    expect(detail.peopleCovered).toBe(2 * PEOPLE_PER_CITIZEN);
  });

  it('serves exactly the buildings the coverage field itself credits', () => {
    const sim = cityWithoutUtilities();
    const base = findLandBlock(sim, 24, 8);
    expect(
      sim.world.submit('placeRoad', { ax: base.x, ay: base.y, bx: base.x + 22, by: base.y }),
    ).toBe(true);
    sim.world.step();
    const radius = SERVICE_RADIUS.garden;
    // Coverage is marked per COVERAGE_BLOCK_SIZE block, so a service reaches
    // past its nominal radius by however much the block grid overhangs. Pick an
    // anchor where the overhang is NON-ZERO, or the two metrics coincide and
    // this test cannot fail.
    const anchorX =
      (base.x + 1 + radius) % COVERAGE_BLOCK_SIZE === COVERAGE_BLOCK_SIZE - 1
        ? base.x + 2
        : base.x + 1;
    const homes: { d: number; id: number }[] = [];
    for (let d = 0; d <= radius + 6; d++) {
      homes.push({
        d,
        id: seedBuilding(sim, { x: anchorX + 2 + d, y: base.y + 3, zone: 'R', residents: 1 }),
      });
    }
    expect(
      sim.world.submit('placeService', { service: 'garden', x: anchorX, y: base.y + 1 }),
    ).toBe(true);
    for (let i = 0; i < 20; i++) sim.world.step();
    const garden = [...sim.world.query('structure')][0];

    const credited = homes.filter(
      ({ id }) => growable(sim, id).needs.find((need) => need.name === 'green space')?.covered,
    );
    const detail = buildingDetail(sim, garden) as ServiceBuildingDetail;

    // Non-vacuous on both sides, and genuinely block-granular: at least one
    // credited home sits BEYOND the nominal radius, which is exactly the band
    // an exact-Chebyshev count would wrongly disown.
    expect(credited.length).toBeGreaterThan(0);
    expect(credited.length).toBeLessThan(homes.length);
    expect(credited.some(({ d }) => d > radius)).toBe(true);
    // And the garden's own count is that same set, not a stricter one.
    expect(detail.buildingsCovered).toBe(credited.length);
    expect(detail.peopleCovered).toBe(credited.length * PEOPLE_PER_CITIZEN);
  });

  it('counts children walking to and sitting in a school', () => {
    const sim = city();
    const origin = roadedSite(sim);
    expect(
      sim.world.submit('placeService', { service: 'school', x: origin.x + 3, y: origin.y + 1 }),
    ).toBe(true);
    sim.world.step();
    const school = [...sim.world.query('structure')][0];
    const generation = sim.world.getEntityGeneration(school);
    const home = seedBuilding(sim, { x: origin.x + 1, y: origin.y + 1, zone: 'R', residents: 1 });
    const household = seedCitizen(sim, home, null);
    sim.world.runMaintenance(() => {
      sim.world.addComponent(household, 'memberTrip', {
        slots: [
          { memberId: 1, phase: 'atPlace', place: school, placeGen: generation, purpose: 'school', waitUntil: 0 },
          { memberId: 2, phase: 'toPlace', place: school, placeGen: generation, purpose: 'school', waitUntil: 0 },
        ],
      });
    });

    const detail = buildingDetail(sim, school) as ServiceBuildingDetail;

    expect(detail.attendance).toEqual({ present: 1, walking: 1 });
  });

  it('separates households walking to a green venue from those already there', () => {
    const sim = city();
    const origin = roadedSite(sim);
    expect(
      sim.world.submit('placeService', { service: 'park', x: origin.x + 3, y: origin.y + 1 }),
    ).toBe(true);
    sim.world.step();
    const park = [...sim.world.query('structure')][0];
    const gen = sim.world.getEntityGeneration(park);
    const home = seedBuilding(sim, { x: origin.x + 1, y: origin.y + 1, zone: 'R', residents: 4 });
    seedCitizen(sim, home, null, { phase: 'toShop', shop: park, shopGen: gen });
    seedCitizen(sim, home, null, { phase: 'atShop', shop: park, shopGen: gen });
    // `shop` is retained all the way home, so a walker on the RETURN leg is
    // neither heading here nor here — counting it was the original defect.
    seedCitizen(sim, home, null, { phase: 'toHome', shop: park, shopGen: gen });

    const detail = buildingDetail(sim, park) as ServiceBuildingDetail;

    expect(detail.visitors).toEqual({ inbound: 1, present: 1 });
    expect(detail.attendance).toBeNull();
  });
});

describe('utility detail', () => {
  it('reports a plant against the same city totals the HUD reads', () => {
    const sim = city();
    const origin = roadedSite(sim);
    expect(sim.world.submit('placePowerPlant', { kind: 'coal', x: origin.x, y: origin.y + 3 })).toBe(
      true,
    );
    sim.world.step();
    const plant = [...sim.world.query('powerPlant')][0];

    const detail = buildingDetail(sim, plant) as PowerPlantDetail;

    expect(detail.kind).toBe('powerPlant');
    expect(detail.plant).toBe('coal');
    expect(detail.capacity).toBe(POWER_PLANT_CAPACITY.coal);
    expect(detail.pollution).toBeGreaterThan(0);
    expect(detail.city).toEqual(utilityTotals(sim.world).power);
    expect(detail.w).toBe(3);
  });

  it('reports a wind turbine as emitting nothing', () => {
    const sim = city();
    const origin = roadedSite(sim);
    expect(sim.world.submit('placePowerPlant', { kind: 'wind', x: origin.x, y: origin.y + 3 })).toBe(
      true,
    );
    sim.world.step();
    const plant = [...sim.world.query('powerPlant')][0];

    expect((buildingDetail(sim, plant) as PowerPlantDetail).pollution).toBe(0);
  });

  it('reports a pump against the city water totals', () => {
    const sim = city();
    const target = findLandBlock(sim, 4, 4);
    const spot = findConnectablePumpSpot(sim, target);
    expect(sim.world.submit('placeWaterPump', { x: spot.x, y: spot.y })).toBe(true);
    sim.world.step();
    const pump = [...sim.world.query('waterPump')][0];

    const detail = buildingDetail(sim, pump) as WaterPumpDetail;

    expect(detail.kind).toBe('waterPump');
    expect(detail.capacity).toBe(WATER_PUMP_CAPACITY);
    expect(detail.city).toEqual(utilityTotals(sim.world).water);
  });
});

describe('building detail refusals', () => {
  it('names what a non-building entity actually is instead of returning a bare null', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 5, y: 5, zone: 'R', residents: 1 });
    const household = seedCitizen(sim, home, null);

    expect(buildingDetail(sim, household)).toBeNull();
    expect(buildingDetailProblem(sim, household)).toMatch(/household, not a building/);
  });

  it('says a demolished building is gone rather than describing nothing', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 5, y: 5, zone: 'R', residents: 1 });
    sim.world.runMaintenance(() => sim.world.destroyEntity(home));

    expect(buildingDetail(sim, home)).toBeNull();
    expect(buildingDetailProblem(sim, home)).toMatch(/no longer in the city/);
  });
});
