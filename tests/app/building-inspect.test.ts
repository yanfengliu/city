import { describe, expect, it } from 'vitest';
import { buildingInspectData } from '../../src/app/building-inspect';
import type {
  GrowableBuildingDetail,
  PowerPlantDetail,
  ServiceBuildingDetail,
  WaterPumpDetail,
} from '../../src/protocol/messages';
import { inspectSectionKey } from '../../src/ui/inspect-panel';
import { UTILITY_BRIDGE_RADIUS } from '../../src/sim/constants/utilities';

/**
 * The panel's wording contract. It exists so a player reading a building panel
 * is told what THIS kind of building does — a shop must not be described in
 * residents, and a school must not be described only as a coverage radius.
 */

function growable(overrides: Partial<GrowableBuildingDetail> = {}): GrowableBuildingDetail {
  return {
    kind: 'growable',
    entity: 12,
    generation: 3,
    x: 14,
    y: 30,
    w: 2,
    h: 2,
    tick: 900,
    zone: 'R',
    level: 1,
    maxLevel: 3,
    abandoned: false,
    households: 4,
    people: 12,
    peopleCapacity: 16,
    jobsFilled: 0,
    jobCapacity: 16,
    householdsOut: 1,
    inbound: 0,
    present: 0,
    score: {
      value: 30,
      landValue: 40,
      landValueWeight: 0.5,
      coverage: 16,
      coverageCount: 2,
      utilityBonus: 10,
      taxPenalty: 6,
      base: 0,
      abandonAt: 12,
      nextLevelAt: 45,
      upEvals: 0,
      levelUpEvals: 3,
      badEvals: 0,
      abandonEvals: 10,
      badUtilityEvals: 0,
      utilityAbandonEvals: 75,
      recoverEvals: 0,
      recoverEvalsNeeded: 3,
    },
    growthBlocker: 'none',
    needs: [
      { name: 'fire station', covered: true },
      { name: 'police station', covered: true },
      { name: 'clinic', covered: false },
      { name: 'school', covered: false },
      { name: 'green space', covered: false },
    ],
    pollution: 3,
    noise: 5,
    powered: true,
    watered: true,
    utilityDemand: 4,
    educationOk: true,
    schoolCovered: false,
    schoolingCurrent: true,
    taxRate: 9,
    roadConnected: true,
    ...overrides,
  };
}

function service(overrides: Partial<ServiceBuildingDetail> = {}): ServiceBuildingDetail {
  return {
    kind: 'service',
    entity: 20,
    generation: 1,
    x: 6,
    y: 8,
    w: 2,
    h: 2,
    tick: 900,
    service: 'school',
    radius: 32,
    cost: 500,
    upkeep: 10,
    buildingsCovered: 24,
    peopleCovered: 180,
    attendance: { walking: 2, present: 7 },
    visitors: null,
    ...overrides,
  };
}

function plant(overrides: Partial<PowerPlantDetail> = {}): PowerPlantDetail {
  return {
    kind: 'powerPlant',
    entity: 30,
    generation: 0,
    x: 2,
    y: 2,
    w: 3,
    h: 3,
    tick: 900,
    plant: 'coal',
    capacity: 400,
    cost: 800,
    upkeep: 16,
    pollution: 30,
    bridgeRadius: 5,
    city: { supply: 400, demand: 430 },
    ...overrides,
  };
}

function pump(overrides: Partial<WaterPumpDetail> = {}): WaterPumpDetail {
  return {
    kind: 'waterPump',
    entity: 31,
    generation: 0,
    x: 9,
    y: 4,
    w: 1,
    h: 1,
    tick: 900,
    capacity: 300,
    cost: 500,
    upkeep: 10,
    bridgeRadius: 5,
    city: { supply: 300, demand: 120 },
    ...overrides,
  };
}

function sectionIds(detail: Parameters<typeof buildingInspectData>[0]): string[] {
  return (buildingInspectData(detail).sections ?? []).map(inspectSectionKey);
}

function sectionText(
  detail: Parameters<typeof buildingInspectData>[0],
  id: string,
): string {
  const section = (buildingInspectData(detail).sections ?? []).find(
    (candidate) => inspectSectionKey(candidate) === id,
  );
  if (!section) throw new Error(`no section ${id} in ${sectionIds(detail).join(', ')}`);
  return section.lines.join(' | ');
}

describe('residential panel', () => {
  it('leads with people, not job slots, and offers the resident drill-down through actions', () => {
    const data = buildingInspectData(growable(), [
      { label: 'Meet a resident', onClick: () => {} },
    ]);

    expect(data.title).toBe('Home — Level 1');
    expect(data.subtitle).toBe('Residential · 2×2 cells at (14, 30)');
    expect(data.meter).toMatchObject({ label: 'Occupancy', caption: '12 / 16 people' });
    expect(sectionText(growable(), 'occupancy')).toContain('12 residents in 4 households');
    expect(sectionText(growable(), 'occupancy')).toContain('1 household out of the house');
    expect(data.actions?.[0].label).toBe('Meet a resident');
  });

  it('groups the details instead of stacking them, closing the reference sections', () => {
    const sections = buildingInspectData(growable()).sections ?? [];

    expect(sections.map(inspectSectionKey)).toEqual([
      'occupancy',
      'growth',
      'utilities',
      'services',
      'neighbourhood',
    ]);
    // What is happening now stays open; reference material starts collapsed.
    expect(sections.filter((section) => section.startCollapsed).map(inspectSectionKey)).toEqual([
      'services',
      'neighbourhood',
    ]);
    // Every collapsed section still says something from its header.
    for (const section of sections) expect(section.summary).toBeTruthy();
  });

  it('says how far short of the next level the building is', () => {
    expect(sectionText(growable(), 'growth')).toContain('Level 2 needs 45 — 15.0 short');
  });

  it('separates a missing school from a school no child reaches', () => {
    const met = { value: 50, nextLevelAt: 45 };
    const noSchool = growable({
      level: 2,
      educationOk: false,
      schoolCovered: false,
      growthBlocker: 'education',
      score: { ...growable().score, ...met },
    });
    const unreached = growable({
      level: 2,
      educationOk: false,
      schoolCovered: true,
      schoolingCurrent: false,
      growthBlocker: 'education',
      score: { ...growable().score, ...met },
    });

    expect(sectionText(noSchool, 'growth')).toContain('no school covers this block');
    expect(sectionText(unreached, 'growth')).toContain('no child here has reached it lately');
  });

  it('turns a missing utility into the fix, not just a red cross', () => {
    const dark = growable({
      powered: false,
      growthBlocker: 'utilities',
      score: { ...growable().score, badUtilityEvals: 30 },
    });
    const section = (buildingInspectData(dark).sections ?? []).find(
      (candidate) => inspectSectionKey(candidate) === 'utilities',
    )!;

    expect(section.summary).toContain('⚡');
    expect(section.lines.join(' | ')).toContain(
      `Run a power line or pipe within ${UTILITY_BRIDGE_RADIUS} cells`,
    );
    expect(section.meters?.[0]).toMatchObject({
      label: 'Abandonment risk',
      worseWhenFull: true,
    });
  });

  it('describes an abandoned building by what would bring it back', () => {
    const data = buildingInspectData(
      growable({
        abandoned: true,
        households: 0,
        people: 0,
        growthBlocker: 'abandoned',
        score: { ...growable().score, value: 8, recoverEvals: 1 },
      }),
    );

    expect(data.abandoned).toBe(true);
    const growth = data.sections!.find((section) => inspectSectionKey(section) === 'growth')!;
    expect(growth.summary).toBe('Abandoned');
    expect(growth.lines.join(' | ')).toContain('needs 12 to be used again');
    expect(growth.lines.join(' | ')).toContain('before anyone moves back in');
    expect(growth.meters?.[0]).toMatchObject({ label: 'Recovery' });
  });

  it('describes a shop in jobs and shoppers, never in residents', () => {
    const shop = growable({
      zone: 'C',
      households: 0,
      people: 0,
      jobsFilled: 6,
      inbound: 3,
      present: 2,
    });
    const data = buildingInspectData(shop);

    expect(data.title).toBe('Shop — Level 1');
    expect(data.meter?.label).toBe('Jobs filled');
    const occupancy = sectionText(shop, 'occupancy');
    expect(occupancy).toContain('6 jobs filled of 16');
    expect(occupancy).toContain('3 households walking here to shop');
    expect(occupancy).toContain('2 households shopping here right now');
    expect(occupancy).not.toContain('resident');
  });

  it('explains why industrial land value barely matters', () => {
    const factory = growable({
      zone: 'I',
      score: { ...growable().score, landValueWeight: 0.1, base: 15, taxPenalty: 0 },
    });

    expect(buildingInspectData(factory).title).toBe('Factory — Level 1');
    expect(sectionText(factory, 'neighbourhood')).toContain('a flat 15 points carries it instead');
  });

  it('says nothing about a next level once the building is at the top', () => {
    const top = growable({
      level: 3,
      growthBlocker: 'maxLevel',
      score: { ...growable().score, nextLevelAt: null },
    });

    expect(sectionText(top, 'growth')).toContain('Level 3 is the highest');
    const growth = buildingInspectData(top).sections!.find(
      (section) => inspectSectionKey(section) === 'growth',
    )!;
    expect(growth.meters ?? []).toHaveLength(0);
  });
});

describe('service panel', () => {
  it('tells a school about its pupils, not only its radius', () => {
    const data = buildingInspectData(service());

    expect(data.title).toBe('School');
    expect(sectionIds(service())).toEqual(['coverage', 'attendance', 'costs']);
    expect(sectionText(service(), 'attendance')).toContain('7 children in class right now');
    expect(sectionText(service(), 'attendance')).toContain('2 children still walking here');
  });

  it('tells a park about visitors and a clinic about neither', () => {
    const park = service({
      service: 'park',
      radius: 10,
      attendance: null,
      visitors: { inbound: 2, present: 1 },
    });
    const clinic = service({ service: 'clinic', radius: 32, attendance: null, visitors: null });

    expect(sectionIds(park)).toEqual(['coverage', 'visitors', 'costs']);
    expect(sectionText(park, 'visitors')).toContain('2 households walking here');
    expect(sectionText(park, 'visitors')).toContain('1 household out here right now');
    expect(sectionIds(clinic)).toEqual(['coverage', 'costs']);
    expect(buildingInspectData(clinic).title).toBe('Clinic');
  });

  it('reports the reach in buildings and people served', () => {
    expect(sectionText(service(), 'coverage')).toContain('Serving 24 buildings and 180 residents');
  });
});

describe('utility panels', () => {
  it('warns when the city draws more than it can supply', () => {
    const data = buildingInspectData(plant());

    expect(data.title).toBe('Coal power plant');
    expect(sectionIds(plant())).toEqual(['output', 'emissions', 'reach', 'costs']);
    expect(sectionText(plant(), 'output')).toContain('30 units short city-wide');
    expect(sectionText(plant(), 'emissions')).toContain('Adds 30 pollution');
  });

  it('calls a wind turbine clean rather than printing a zero', () => {
    const wind = plant({ plant: 'wind', capacity: 40, pollution: 0, w: 1, h: 1 });
    const emissions = buildingInspectData(wind).sections!.find(
      (section) => inspectSectionKey(section) === 'emissions',
    )!;

    expect(buildingInspectData(wind).title).toBe('Wind turbine');
    expect(emissions.summary).toBe('Clean');
    expect(emissions.lines.join(' ')).toContain('Emits nothing');
  });

  it('describes a pump in water, with no emissions section at all', () => {
    const data = buildingInspectData(pump());

    expect(data.title).toBe('Water pump');
    expect(sectionIds(pump())).toEqual(['output', 'reach', 'costs']);
    expect(sectionText(pump(), 'output')).toContain('Installed capacity covers the whole city');
    expect(sectionText(pump(), 'reach')).toContain('Pipes carry water');
  });
});

describe('every panel', () => {
  it('keeps the flat line fallback in step with its sections for text-mode readers', () => {
    for (const detail of [growable(), service(), plant(), pump()]) {
      const data = buildingInspectData(detail);
      expect(data.lines).toEqual((data.sections ?? []).flatMap((section) => section.lines));
      expect(data.lines.length).toBeGreaterThan(0);
    }
  });

  it('keys the subject by incarnation so a rebuilt block is a new subject', () => {
    expect(buildingInspectData(growable()).subjectKey).toBe('building:12:3');
    expect(buildingInspectData(growable({ generation: 4 })).subjectKey).toBe('building:12:4');
    expect(buildingInspectData(service()).subjectKey).toBe('structure:20:1');
    expect(buildingInspectData(plant()).subjectKey).toBe('plant:30:0');
    expect(buildingInspectData(pump()).subjectKey).toBe('pump:31:0');
  });
});

describe('an abandoned building is not warned about a deadline it already missed', () => {
  it('drops the countdown and the risk bar but keeps the fix', () => {
    const dark = growable({
      abandoned: true,
      powered: false,
      watered: false,
      growthBlocker: 'abandoned',
      score: { ...growable().score, badUtilityEvals: 0 },
    });
    const section = (buildingInspectData(dark).sections ?? []).find(
      (candidate) => inspectSectionKey(candidate) === 'utilities',
    )!;

    expect(section.meters ?? []).toHaveLength(0);
    expect(section.lines.join(' | ')).not.toContain('checks before');
    expect(section.lines.join(' | ')).toContain('Run a power line or pipe');
    // The reach comes from the sim constant, never a number retyped here.
    expect(section.lines.join(' | ')).toContain(`${UTILITY_BRIDGE_RADIUS} cells`);
  });

  it('names what each zone loses when its utilities are cut', () => {
    const cut = (zone: 'R' | 'C' | 'I') =>
      (buildingInspectData(growable({ zone, powered: false, growthBlocker: 'utilities' })).sections ?? [])
        .find((section) => inspectSectionKey(section) === 'utilities')!
        .lines.join(' | ');

    expect(cut('R')).toContain('before the residents leave');
    expect(cut('C')).toContain('before the shop closes');
    expect(cut('I')).toContain('before the factory closes');
  });
});

describe('wording that has to survive edge values', () => {
  it('counts one unit as a unit, not "1 units"', () => {
    const one = growable({ utilityDemand: 1 });
    expect(sectionText(one, 'utilities')).toContain('Draws 1 unit of power');
    expect(sectionText(growable({ utilityDemand: 4 }), 'utilities')).toContain('Draws 4 units');
  });

  it('does not claim everyone is home in an empty building', () => {
    const empty = growable({ households: 0, people: 0, householdsOut: 0 });
    expect(sectionText(empty, 'occupancy')).toContain('Nobody lives here yet');
    expect(sectionText(empty, 'occupancy')).not.toContain('Everyone is home');
  });

  it('stops demanding a threshold an abandoned building already clears', () => {
    const scoreOk = growable({
      abandoned: true,
      growthBlocker: 'abandoned',
      score: { ...growable().score, value: 36.5 },
    });
    expect(sectionText(scoreOk, 'growth')).toContain('already clears the 12 it needs');
    expect(sectionText(scoreOk, 'growth')).not.toContain('needs 12 to be used again');
  });
});

describe('the growth section never promises what the sim will refuse', () => {
  /** Score clears the level-2 bar, but the utilities gate is shut. */
  const stalled = () =>
    growable({
      powered: false,
      growthBlocker: 'utilities',
      score: { ...growable().score, value: 90, nextLevelAt: 45 },
    });

  it('shows no progress bar while the level path is blocked outright', () => {
    const growth = buildingInspectData(stalled()).sections!.find(
      (section) => inspectSectionKey(section) === 'growth',
    )!;

    // A full green "Toward level 2" bar was the defect: the sim skips the whole
    // level evaluation while power or water is missing, so it never advances.
    expect(growth.meters ?? []).toHaveLength(0);
    expect(growth.summary).toBe('Level 1 — stalled');
  });

  it('names the missing utility as the reason, not the good-check counter', () => {
    const text = sectionText(stalled(), 'growth');

    expect(text).toContain('Stalled: no power — nothing levels up');
    expect(text).not.toContain('Levelling up:');
  });

  it('says which utility is missing when it is water, or both', () => {
    const dry = growable({
      watered: false,
      growthBlocker: 'utilities',
      score: { ...growable().score, value: 90, nextLevelAt: 45 },
    });
    const both = growable({
      powered: false,
      watered: false,
      growthBlocker: 'utilities',
      score: { ...growable().score, value: 90, nextLevelAt: 45 },
    });

    expect(sectionText(dry, 'growth')).toContain('Stalled: no water');
    expect(sectionText(both, 'growth')).toContain('Stalled: no power and no water');
  });

  it('still counts good checks once nothing is blocking', () => {
    const ready = growable({
      growthBlocker: 'none',
      score: { ...growable().score, value: 90, nextLevelAt: 45, upEvals: 2 },
    });

    expect(sectionText(ready, 'growth')).toContain('Levelling up: 2 of 3 good checks');
    const growth = buildingInspectData(ready).sections!.find(
      (section) => inspectSectionKey(section) === 'growth',
    )!;
    expect(growth.meters?.[0]).toMatchObject({ label: 'Toward level 2' });
  });
});
