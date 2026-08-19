import { describe, expect, it } from 'vitest';
import { createCitySim, rebuildDerived, type CitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import {
  TICKS_PER_DAY,
  WINDOW_START_LOCAL_TICKS,
  windowAt,
} from '../../src/protocol/city-clock';
import {
  SCHOOL_RETURN_LOCAL_TICK,
  SCHOOL_RETURN_SPREAD_TICKS,
} from '../../src/sim/constants/routine';
import { memberOffset, schoolDismissalAfter } from '../../src/sim/routine';
import { CITIZEN_PRIMARY_MEMBER_ID } from '../../src/sim/constants/citizens';
import { createCitizenProfile } from '../../src/sim/citizen-profile';
import { citizenDetail } from '../../src/sim/citizen-detail';
import type { CitizenLifeStage, CitizenProfile } from '../../src/sim/types';
import { citizenOf, seedBuilding, seedCitizen } from './helpers';
import { accessCell, buildingAccessCell } from '../../src/sim/traffic/pathing';
import { handleSchoolArrival, memberSlots, schoolFor } from '../../src/sim/traffic/schools';

/** A staged roster: primary adult worker plus the given stages for members 1/2. */
function stagedProfile(base: CitizenProfile, stages: [CitizenLifeStage, CitizenLifeStage]): CitizenProfile {
  return {
    ...base,
    members: base.members.map((member, index) =>
      index === 0
        ? member
        : {
            ...member,
            lifeStage: stages[index - 1],
            age: stages[index - 1] === 'child' ? 9 : stages[index - 1] === 'senior' ? 70 : 34,
          },
    ),
  };
}

interface SchoolTown {
  sim: CitySim;
  citizen: number;
  home: number;
  work: number;
  school: number | null;
  childMemberId: number;
}

/**
 * One street with a home, a workplace, and (unless withheld) a 2x2 school in
 * coverage and walking range. The household's second member is staged as a
 * child so the school run has someone to make.
 */
function schoolTown(options: { school?: boolean; seed?: number } = {}): SchoolTown {
  const sim = createCitySim({ seed: options.seed ?? 7 });
  const y = 60;
  for (let x = 18; x <= 46; x++) {
    for (const row of [y, y + 1, y + 2]) {
      const cell = cellIndex(x, row);
      sim.terrain.water[cell] = 0;
      sim.terrain.trees[cell] = 0;
      sim.terrain.elevation[cell] = sim.terrain.seaLevel;
    }
  }
  expect(sim.world.submit('placeRoad', { ax: 18, ay: y, bx: 46, by: y })).toBe(true);
  sim.world.step();

  const home = seedBuilding(sim, { x: 20, y: y + 1, zone: 'R', residents: 1 });
  const work = seedBuilding(sim, { x: 40, y: y + 1, zone: 'I', jobsFilled: 1 });
  let school: number | null = null;
  if (options.school !== false) {
    expect(sim.world.submit('placeService', { service: 'school', x: 30, y: y + 1 })).toBe(true);
    sim.world.step();
    school = [...sim.world.query('structure')].find(
      (id) => sim.world.getComponent(id, 'structure')?.type === 'school',
    ) ?? null;
    expect(school).not.toBeNull();
  }
  const citizen = seedCitizen(sim, home, work);
  const base = createCitizenProfile(
    sim.seed,
    citizen,
    sim.world.getEntityGeneration(citizen),
    home,
  );
  const profile = stagedProfile(base, ['adult', 'child']);
  sim.world.runMaintenance(() => {
    sim.world.addComponent(citizen, 'citizenProfile', profile);
  });
  const child = profile.members.find((m) => m.lifeStage === 'child');
  expect(child).toBeDefined();
  return { sim, citizen, home, work, school, childMemberId: child!.id };
}

function slotsOf(sim: CitySim, citizen: number) {
  return sim.world.getComponent(citizen, 'memberTrip')?.slots ?? [];
}

function schoolWalkers(sim: CitySim): number[] {
  return [...sim.world.query('pedestrianPath')].filter(
    (id) => sim.world.getComponent(id, 'pedestrianPath')?.purpose === 'school',
  );
}

describe('school runs (D2)', () => {
  it('sends the child to the covering school while the worker is at work — simultaneously', { timeout: 30_000 }, () => {
    const { sim, citizen, childMemberId } = schoolTown();
    let simultaneous = false;
    let childWalkerSeen = false;
    for (let i = 0; i < WINDOW_START_LOCAL_TICKS.evening; i++) {
      sim.world.step();
      const household = citizenOf(sim, citizen);
      const slots = slotsOf(sim, citizen);
      const childSlot = slots.find((s) => s.memberId === childMemberId);
      if (schoolWalkers(sim).length > 0) childWalkerSeen = true;
      if (household.phase === 'atWork' && childSlot?.phase === 'atPlace') simultaneous = true;
    }
    expect(childWalkerSeen, 'a school walker existed').toBe(true);
    expect(simultaneous, 'worker at work while the child was at school').toBe(true);
  });

  it('departs only in the morning window and is home before evening', { timeout: 30_000 }, () => {
    const { sim, citizen, childMemberId } = schoolTown();
    const departures: number[] = [];
    const returns: number[] = [];
    let lastPhase: string | null = null;
    for (let i = 0; i < TICKS_PER_DAY + WINDOW_START_LOCAL_TICKS.day; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      const phase = slot?.phase ?? 'home';
      if (phase !== lastPhase) {
        if (phase === 'toPlace') departures.push(sim.world.tick);
        if (lastPhase === 'toHome' && phase === 'home') returns.push(sim.world.tick);
        lastPhase = phase;
      }
      // At night the child is always home.
      if (windowAt(sim.world.tick) === 'night') {
        expect(phase, `child out at night tick ${sim.world.tick}`).toBe('home');
      }
    }
    expect(departures.length).toBeGreaterThan(0);
    for (const tick of departures) {
      expect(windowAt(tick), `school departure at ${tick}`).toBe('morning');
    }
    expect(returns.length).toBeGreaterThan(0);
    for (const tick of returns) {
      // Home again in the afternoon: at/after the return moment, before evening ends.
      expect(tick % TICKS_PER_DAY).toBeGreaterThanOrEqual(SCHOOL_RETURN_LOCAL_TICK);
      expect(['day', 'evening']).toContain(windowAt(tick));
    }
  });

  it('keeps the child home when no school covers the home', { timeout: 30_000 }, () => {
    const { sim, citizen } = schoolTown({ school: false });
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      sim.world.step();
      expect(slotsOf(sim, citizen)).toHaveLength(0);
    }
    expect(schoolWalkers(sim)).toHaveLength(0);
  });

  it('never leaves a travelling slot without its walker', { timeout: 30_000 }, () => {
    const { sim, citizen, childMemberId } = schoolTown();
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      if (slot && (slot.phase === 'toPlace' || slot.phase === 'toHome')) {
        expect(
          schoolWalkers(sim).length,
          `slot ${slot.phase} at tick ${sim.world.tick} with no school walker`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the school run alive when the household loses its workplace mid-walk', { timeout: 30_000 }, () => {
    const { sim, citizen, work, childMemberId } = schoolTown({ seed: 5 });
    // Step until the child is genuinely mid-walk to school.
    let walking = false;
    for (let i = 0; i < TICKS_PER_DAY && !walking; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      walking = slot?.phase === 'toPlace' && schoolWalkers(sim).length > 0;
    }
    expect(walking, 'child reached a mid-walk school leg').toBe(true);

    // The parent's workplace is bulldozed out from under them. Losing a job is
    // nothing to do with the child's school run, and must not strand the slot.
    const { x, y } = sim.world.getComponent(work, 'position')!;
    rebuildDerived(sim); // seeded buildings only enter occupiedCells here
    expect(sim.world.submit('bulldozeRect', { ax: x, ay: y, bx: x, by: y })).toBe(true);
    sim.world.step();
    expect(citizenOf(sim, citizen).work, 'workplace cleared').toBeNull();

    // The invariant the diff claims: a travelling slot always has its walker.
    let reachedSchool = false;
    let cameHome = false;
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      if (slot && (slot.phase === 'toPlace' || slot.phase === 'toHome')) {
        expect(
          schoolWalkers(sim).length,
          `slot ${slot.phase} at tick ${sim.world.tick} with no school walker`,
        ).toBeGreaterThan(0);
      }
      if (slot?.phase === 'atPlace') reachedSchool = true;
      if (reachedSchool && !slot) cameHome = true;
    }
    expect(reachedSchool, 'child still reached school after the job loss').toBe(true);
    expect(cameHome, 'child still came home after the job loss').toBe(true);
  });

  it('describes the household commuter, not the child, while both are out', { timeout: 30_000 }, () => {
    const { sim, citizen, work, childMemberId } = schoolTown({ seed: 3 });
    let checked = false;
    for (let i = 0; i < TICKS_PER_DAY && !checked; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      const household = citizenOf(sim, citizen);
      const householdOut = household.phase === 'toWork' || household.phase === 'toHome';
      const childOut = slot?.phase === 'toPlace' || slot?.phase === 'toHome';
      if (!householdOut || !childOut) continue;
      checked = true;
      const detail = citizenDetail(sim, citizen);
      expect(detail, 'detail resolved').not.toBeNull();
      // The household row is the commuter's, so its agent must not be the
      // child's school walker riding in on a lower entity id.
      const agentEntity = detail!.agent?.entity ?? null;
      expect(
        agentEntity === null || !schoolWalkers(sim).includes(agentEntity),
        'household detail bound to the school walker',
      ).toBe(true);
      if (household.phase === 'toWork') {
        expect(detail!.destination?.entity, 'commute destination is the workplace').toBe(work);
      }
    }
    expect(checked, 'saw the worker and the child out at the same time').toBe(true);
  });

  it('sends the child whenever the education overlay says the home is covered', { timeout: 60_000 }, () => {
    // A diagonal home: Chebyshev (the coverage metric the player sees, and the
    // one growth's `educated` reads) puts it well inside the radius, while
    // Manhattan between access cells does not. The two must not disagree.
    const sim = createCitySim({ seed: 21 });
    const homeX = 20, homeY = 60, schoolX = 42, schoolY = 42;
    for (let x = 18; x <= 46; x++) {
      for (let y = 40; y <= 62; y++) {
        const cell = cellIndex(x, y);
        sim.terrain.water[cell] = 0;
        sim.terrain.trees[cell] = 0;
        sim.terrain.elevation[cell] = sim.terrain.seaLevel;
      }
    }
    // An L of road so the two are genuinely connected by pavement.
    expect(sim.world.submit('placeRoad', { ax: homeX, ay: homeY, bx: schoolX, by: homeY })).toBe(true);
    sim.world.step();
    expect(sim.world.submit('placeRoad', { ax: schoolX, ay: homeY, bx: schoolX, by: schoolY })).toBe(true);
    sim.world.step();

    const home = seedBuilding(sim, { x: homeX, y: homeY + 1, zone: 'R', residents: 1 });
    const work = seedBuilding(sim, { x: homeX + 2, y: homeY + 1, zone: 'I', jobsFilled: 1 });
    expect(sim.world.submit('placeService', { service: 'school', x: schoolX + 1, y: schoolY })).toBe(true);
    sim.world.step();
    rebuildDerived(sim);

    // The gate: the overlay paints this home covered.
    expect(sim.fields.coverage.school.getAt(homeX, homeY + 1), 'overlay says covered').toBeGreaterThan(0);
    // Guard the instrument: this fixture must genuinely straddle the two
    // metrics, or the test proves nothing.
    const homeAccessCell = buildingAccessCell(sim, home)!;
    const schoolEntity = [...sim.world.query('structure')].find(
      (id) => sim.world.getComponent(id, 'structure')?.type === 'school',
    )!;
    const schoolAccessCell = accessCell(sim, schoolEntity)!;
    const manhattan =
      Math.abs((homeAccessCell % 128) - (schoolAccessCell % 128)) +
      Math.abs(Math.floor(homeAccessCell / 128) - Math.floor(schoolAccessCell / 128));
    expect(manhattan, 'fixture is Manhattan-far (the old gate would reject it)').toBeGreaterThan(32);

    const citizen = seedCitizen(sim, home, work);
    const base = createCitizenProfile(sim.seed, citizen, sim.world.getEntityGeneration(citizen), home);
    const profile = stagedProfile(base, ['adult', 'child']);
    sim.world.runMaintenance(() => {
      sim.world.addComponent(citizen, 'citizenProfile', profile);
    });
    const childMemberId = profile.members.find((m) => m.lifeStage === 'child')!.id;

    let attended = false;
    for (let i = 0; i < TICKS_PER_DAY && !attended; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      if (slot) attended = true;
    }
    expect(attended, 'covered home sent its child to school').toBe(true);
  });

  it('does not let a nearer unreachable school shadow a reachable one', { timeout: 60_000 }, () => {
    const { sim, citizen, home, school, childMemberId } = schoolTown({ seed: 13 });
    // A second school NEARER by Manhattan but on its own isolated road stub —
    // no pavement joins it to the home's component.
    const stubY = 64;
    for (let x = 17; x <= 26; x++) {
      for (const row of [stubY, stubY + 1, stubY + 2]) {
        const cell = cellIndex(x, row);
        sim.terrain.water[cell] = 0;
        sim.terrain.trees[cell] = 0;
        sim.terrain.elevation[cell] = sim.terrain.seaLevel;
      }
    }
    expect(sim.world.submit('placeRoad', { ax: 17, ay: stubY, bx: 26, by: stubY })).toBe(true);
    sim.world.step();
    expect(sim.world.submit('placeService', { service: 'school', x: 19, y: stubY + 1 })).toBe(true);
    sim.world.step();
    rebuildDerived(sim);

    const homeAccess = buildingAccessCell(sim, home)!;
    const homeComponent = sim.roadGraph.cellComponent.get(homeAccess);
    const decoy = [...sim.world.query('structure')].find(
      (id) => sim.world.getComponent(id, 'structure')?.type === 'school' && id !== school,
    )!;
    const dist = (cell: number) =>
      Math.abs((homeAccess % 128) - (cell % 128)) +
      Math.abs(Math.floor(homeAccess / 128) - Math.floor(cell / 128));
    // Guard the instrument: unless the decoy is genuinely nearer AND genuinely
    // on another component, this test cannot detect the shadowing it targets.
    expect(dist(accessCell(sim, decoy)!), 'decoy is nearer').toBeLessThan(
      dist(accessCell(sim, school!)!),
    );
    expect(
      sim.roadGraph.cellComponent.get(accessCell(sim, decoy)!),
      'decoy is on another road component',
    ).not.toBe(homeComponent);

    // Assert the choice itself: routing through the trip system cannot see this
    // (an unreachable pick simply produces no walker, which is indistinguishable
    // from "not morning yet" and made an earlier version of this test vacuous).
    expect(schoolFor(sim, home), 'chose the reachable school, not the nearer decoy').toBe(school);

    let attended = false;
    for (let i = 0; i < TICKS_PER_DAY && !attended; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      if (slot?.place != null) {
        expect(slot.place, 'walked to the reachable school').toBe(school);
        attended = true;
      }
    }
    expect(attended, 'child still attended the reachable school').toBe(true);
  });

  it('anchors dismissal to departure so the wrapping morning still gets a bell', () => {
    const dawdle = 10;
    const bell = SCHOOL_RETURN_LOCAL_TICK + dawdle;
    const day = 5 * TICKS_PER_DAY;
    // Departing before the bell: dismissal is later the same day.
    expect(schoolDismissalAfter(day + bell - 200, dawdle)).toBe(day + bell);
    // Departing in the morning window PAST local midnight's wrap — the bell is
    // legitimately on the far side, not "already missed".
    const wrapped = day + 3600;
    expect(schoolDismissalAfter(wrapped, dawdle)).toBe(day + TICKS_PER_DAY + bell);
    expect(schoolDismissalAfter(wrapped, dawdle)).toBeGreaterThan(wrapped);
  });

  it('sends a post-bell arrival straight home instead of holding it overnight', { timeout: 30_000 }, () => {
    const { sim, citizen, school, childMemberId } = schoolTown({ seed: 17 });
    // Drive the exact case a long winding walk produces: the child set out in
    // the morning but only lands after their own bell has rung.
    let walker: number | null = null;
    for (let i = 0; i < TICKS_PER_DAY && walker === null; i++) {
      sim.world.step();
      const found = schoolWalkers(sim)[0];
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      if (found !== undefined && slot?.phase === 'toPlace') walker = found;
    }
    expect(walker, 'a school walker to arrive').not.toBeNull();
    const path = sim.world.getComponent(walker!, 'pedestrianPath')!;
    const departedAt = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId)!.waitUntil;
    const dawdle = memberOffset(
      sim.seed,
      citizen,
      sim.world.getEntityGeneration(citizen),
      sim.world.getComponent(citizen, 'citizen')!.home,
      childMemberId,
      SCHOOL_RETURN_SPREAD_TICKS,
    );
    const dismissal = schoolDismissalAfter(departedAt, dawdle);

    // Step the world past the bell, then land the arrival.
    while (sim.world.tick <= dismissal) sim.world.step();
    expect(sim.world.tick, 'arriving after the bell').toBeGreaterThan(dismissal);
    // Strict mode: component writes need a tick phase or a maintenance window.
    sim.world.runMaintenance(() => handleSchoolArrival(sim, sim.world, path));

    const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId)!;
    expect(slot.phase).toBe('atPlace');
    expect(
      slot.waitUntil,
      "a late arrival must be due home now, not at tomorrow's bell",
    ).toBe(sim.world.tick);
    expect(slot.waitUntil - sim.world.tick).toBeLessThan(TICKS_PER_DAY);
    expect(slot.place).toBe(school);
  });

  it('never puts the same person in two places at once', { timeout: 120_000 }, () => {
    // A wider street than schoolTown: the school sits far from the homes, so a
    // child's walk home is long enough to still be running when the household
    // starts its own free-time outing. The household's leisure/shop traveller
    // is chosen by life stage — usually that very child.
    const sim = createCitySim({ seed: 11 });
    const y = 60;
    for (let x = 10; x <= 60; x++) {
      for (const row of [y, y + 1, y + 2]) {
        const cell = cellIndex(x, row);
        sim.terrain.water[cell] = 0;
        sim.terrain.trees[cell] = 0;
        sim.terrain.elevation[cell] = sim.terrain.seaLevel;
      }
    }
    expect(sim.world.submit('placeRoad', { ax: 10, ay: y, bx: 60, by: y })).toBe(true);
    sim.world.step();
    expect(sim.world.submit('placeService', { service: 'school', x: 46, y: y + 1 })).toBe(true);
    sim.world.step();
    expect(sim.world.submit('placeService', { service: 'park', x: 14, y: y + 1 })).toBe(true);
    sim.world.step();
    const homes: number[] = [];
    for (let x = 18; x <= 30; x += 2) {
      homes.push(seedBuilding(sim, { x, y: y + 1, zone: 'R', residents: 1 }));
    }
    const work = seedBuilding(sim, { x: 34, y: y + 1, zone: 'C', jobsFilled: homes.length });
    rebuildDerived(sim);
    for (const home of homes) {
      const cz = seedCitizen(sim, home, work);
      const base = createCitizenProfile(sim.seed, cz, sim.world.getEntityGeneration(cz), home);
      const profile = stagedProfile(base, ['adult', 'child']);
      sim.world.runMaintenance(() => {
        sim.world.addComponent(cz, 'citizenProfile', profile);
      });
    }

    const collisions: string[] = [];
    for (let i = 0; i < TICKS_PER_DAY * 3 && collisions.length === 0; i++) {
      sim.world.step();
      const live = new Map<string, string>();
      for (const id of [...sim.world.query('pedestrianPath')]) {
        const path = sim.world.getComponent(id, 'pedestrianPath');
        if (!path) continue;
        const key = `${path.citizen}:${path.citizenGen}:${path.memberId}`;
        if (live.has(key)) {
          collisions.push(
            `tick ${sim.world.tick}: ${key} on both a ${live.get(key)} and a ${path.purpose} walker`,
          );
        }
        live.set(key, String(path.purpose));
      }
    }
    expect(collisions, 'one person carried by two agents at once').toEqual([]);
  });

  it('treats a corrupt member slot as absent instead of retiring the member', { timeout: 30_000 }, () => {
    const { sim, citizen, childMemberId } = schoolTown({ seed: 29 });
    // A slot nothing can service: no other code drops one, the due-loop only
    // wakes `atPlace`, and the departure scan skips any member that has a slot
    // — so an unrecognised phase would retire this child permanently.
    sim.world.runMaintenance(() => {
      sim.world.addComponent(citizen, 'memberTrip', {
        slots: [
          { memberId: childMemberId, phase: 'loitering', place: 1, placeGen: 0,
            purpose: 'school', waitUntil: 0 },
        ],
      } as never);
    });
    expect(memberSlots(sim.world, citizen), 'corrupt slot is read as absent').toEqual([]);

    let attended = false;
    for (let i = 0; i < TICKS_PER_DAY * 2 && !attended; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      if (slot?.phase === 'toPlace' || slot?.phase === 'atPlace') attended = true;
    }
    expect(attended, 'child still went to school after the corrupt slot').toBe(true);
  });

  it('never spawns two walkers for one duplicated member slot', () => {
    const { sim, citizen, childMemberId } = schoolTown({ seed: 31 });
    sim.world.runMaintenance(() => {
      sim.world.addComponent(citizen, 'memberTrip', {
        slots: [
          { memberId: childMemberId, phase: 'atPlace', place: 5, placeGen: 0,
            purpose: 'school', waitUntil: 10 },
          { memberId: childMemberId, phase: 'toHome', place: 6, placeGen: 0,
            purpose: 'school', waitUntil: 20 },
        ],
      } as never);
    });
    const slots = memberSlots(sim.world, citizen);
    expect(slots).toHaveLength(1);
    expect(slots[0].phase, 'the first entry wins, deterministically').toBe('atPlace');
  });

  it('round-trips a mid-walk school run through save/load exactly', { timeout: 60_000 }, () => {
    const { sim, citizen } = schoolTown({ seed: 11 });
    // Step until the child is mid-walk to school.
    let walking = false;
    for (let i = 0; i < TICKS_PER_DAY && !walking; i++) {
      sim.world.step();
      walking = schoolWalkers(sim).length > 0;
    }
    expect(walking).toBe(true);

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 11 });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    // Both worlds continue identically through the school day.
    for (let i = 0; i < 600; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(
      JSON.stringify(sim.world.serialize()),
    );
    expect(slotsOf(restored, citizen)).toEqual(slotsOf(sim, citizen));
  });

  it('loads a legacy snapshot without member trips as everyone-home, fabricating nothing', () => {
    const { sim } = schoolTown({ seed: 13 });
    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize())) as {
      components?: Record<string, unknown>;
    };
    // Simulate a pre-D2 save: strip the memberTrip component store entirely.
    if (snapshot.components && 'memberTrip' in snapshot.components) {
      delete snapshot.components.memberTrip;
    }
    const restored = createCitySim({ seed: 13 });
    restored.world.applySnapshot(JSON.parse(JSON.stringify(snapshot)));
    rebuildDerived(restored);
    for (const id of restored.world.query('citizen')) {
      expect(restored.world.getComponent(id, 'memberTrip')).toBeUndefined();
    }
    // The town still runs: stepping resumes school life without a crash.
    for (let i = 0; i < 64; i++) restored.world.step();
  });

  it("reports each member's own whereabouts in the citizen detail", { timeout: 30_000 }, () => {
    const { sim, citizen, childMemberId, school } = schoolTown();
    // Reach the moment the child is at school.
    for (let i = 0; i < 512; i++) {
      sim.world.step();
      const slot = slotsOf(sim, citizen).find((s2) => s2.memberId === childMemberId);
      if (slot?.phase === 'atPlace') break;
    }
    const detail = citizenDetail(sim, citizen, childMemberId);
    expect(detail).not.toBeNull();
    const child = detail!.memberWhereabouts.find((entry) => entry.memberId === childMemberId);
    expect(child?.status).toBe('atSchool');
    expect(child?.place?.entity).toBe(school);
    expect(child?.place?.label).toMatch(/school/i);
    // The other members are accounted for too — home or out with the household.
    for (const entry of detail!.memberWhereabouts) {
      expect(['home', 'household', 'toSchool', 'atSchool', 'walkingHome']).toContain(entry.status);
    }
  });

  it('repeats a school day deterministically for one seed', { timeout: 60_000 }, () => {
    const run = (): string => {
      const { sim } = schoolTown({ seed: 19 });
      for (let i = 0; i < 2_500; i++) sim.world.step();
      return JSON.stringify(sim.world.serialize());
    };
    expect(run()).toBe(run());
  });

  it('walks with the school purpose and settles atPlace by mid-day', { timeout: 30_000 }, () => {
    const { sim, childMemberId, citizen } = schoolTown();
    // Boot is mid-morning past every school moment, so the child departs on
    // the first trip runs; the walker itself carries the school purpose.
    let sawSchoolPurpose = false;
    for (let i = 0; i < 256; i++) {
      sim.world.step();
      if (schoolWalkers(sim).length > 0) sawSchoolPurpose = true;
      const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
      if (slot?.phase === 'atPlace') break;
    }
    expect(sawSchoolPurpose).toBe(true);
    const slot = slotsOf(sim, citizen).find((s) => s.memberId === childMemberId);
    expect(slot?.phase).toBe('atPlace');
    expect(slot?.memberId).not.toBe(CITIZEN_PRIMARY_MEMBER_ID);
  });
});
