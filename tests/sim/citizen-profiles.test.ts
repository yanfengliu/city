import { describe, expect, it } from 'vitest';
import { freeTimeWeights } from '../../src/sim/activities';
import { refreshOccupancy } from '../../src/sim/buildings';
import { citizenDetail } from '../../src/sim/citizen-detail';
import {
  appendCitizenLifeEvent,
  createCitizenProfile,
  hasStoredCitizenProfile,
  profileForCitizen,
  travellerForActivity,
} from '../../src/sim/citizen-profile';
import { moveInSystem } from '../../src/sim/citizens';
import { createCitySim, rebuildDerived, type CitySim } from '../../src/sim/city';
import { CITIZEN_LIFE_EVENT_LIMIT } from '../../src/sim/constants/citizens';
import { employmentSystem, unassignWorkers } from '../../src/sim/employment';
import { markStranded } from '../../src/sim/happiness';
import type {
  CitizenEducation,
  CitizenLifeComponent,
  CitizenLifeStage,
  CitizenMemberProfile,
  CitizenProfile,
} from '../../src/sim/types';
import {
  citizenOf,
  findLandBlock,
  seedBuilding,
  seedCitizen,
  stepUntil,
} from './helpers';

function moveInTown(seed = 7): { sim: CitySim; home: number; citizen: number } {
  const sim = createCitySim({ seed });
  const base = findLandBlock(sim, 3, 3);
  const home = seedBuilding(sim, { x: base.x, y: base.y, zone: 'R' });
  sim.world.runMaintenance(() => {
    sim.world.setState('demand', { r: 1, c: 0, i: 0 });
    moveInSystem(sim)(sim.world);
    sim.world.setState('demand', { r: 0, c: 0, i: 0 });
  });
  const citizens = [...sim.world.query('citizen')];
  expect(citizens, 'move-in fixture did not create exactly one household').toHaveLength(1);
  return { sim, home, citizen: citizens[0] };
}

function employmentTown(): { sim: CitySim; home: number; work: number; citizen: number } {
  const sim = createCitySim({ seed: 19 });
  const base = findLandBlock(sim, 12, 5);
  const streetY = base.y + 2;
  expect(
    sim.world.submit('placeRoad', { ax: base.x, ay: streetY, bx: base.x + 11, by: streetY }),
  ).toBe(true);
  sim.world.step();
  const home = seedBuilding(sim, {
    x: base.x + 1,
    y: streetY + 1,
    zone: 'R',
    residents: 1,
  });
  const work = seedBuilding(sim, { x: base.x + 7, y: streetY + 1, zone: 'I' });
  refreshOccupancy(sim);
  const citizen = seedCitizen(sim, home, null);
  const profile = createCitizenProfile(
    sim.seed,
    citizen,
    sim.world.getEntityGeneration(citizen),
    home,
  );
  sim.world.runMaintenance(() => {
    sim.world.addComponent(citizen, 'citizenProfile', profile);
    sim.world.addComponent(citizen, 'citizenLife', { events: [] });
    sim.world.patchComponent(citizen, 'citizen', (data) => {
      data.travellerMemberId = profile.primaryWorkerMemberId;
    });
  });
  return { sim, home, work, citizen };
}

function stagedProfile(
  profile: CitizenProfile,
  stages: [CitizenLifeStage, CitizenLifeStage, CitizenLifeStage],
): CitizenProfile {
  const educationFor = (stage: CitizenLifeStage): CitizenEducation => {
    if (stage === 'child') return 'primary';
    if (stage === 'teen') return 'secondary';
    return 'trade';
  };
  const ageFor = (stage: CitizenLifeStage): number => {
    if (stage === 'child') return 8;
    if (stage === 'teen') return 15;
    if (stage === 'senior') return 72;
    return 38;
  };
  return {
    ...profile,
    members: profile.members.map((member, index): CitizenMemberProfile => ({
      ...member,
      age: ageFor(stages[index]),
      lifeStage: stages[index],
      education: educationFor(stages[index]),
      role:
        index === 0
          ? 'jobSeeker'
          : stages[index] === 'child'
            ? 'child'
            : stages[index] === 'teen'
              ? 'student'
              : stages[index] === 'senior'
                ? 'retired'
                : 'caregiver',
    })),
  };
}

function setProfile(sim: CitySim, citizen: number, profile: CitizenProfile): void {
  sim.world.runMaintenance(() => {
    if (sim.world.getComponent(citizen, 'citizenProfile')) {
      sim.world.setComponent(citizen, 'citizenProfile', profile);
    } else {
      sim.world.addComponent(citizen, 'citizenProfile', profile);
    }
    sim.world.patchComponent(citizen, 'citizen', (data) => {
      data.travellerMemberId = profile.primaryWorkerMemberId;
    });
  });
}

function profileOf(sim: CitySim, citizen: number): CitizenProfile {
  const profile = sim.world.getComponent(citizen, 'citizenProfile');
  if (!profile) throw new Error(`citizen ${citizen} has no citizenProfile component`);
  return profile;
}

function lifeEventsOf(sim: CitySim, citizen: number) {
  return sim.world.getComponent(citizen, 'citizenLife')?.events ?? [];
}

describe('persistent citizen profiles', () => {
  it('materializes exactly three named people and a move-in event without extra RNG draws', () => {
    const moved = moveInTown(31);
    const citizen = citizenOf(moved.sim, moved.citizen);
    const profile = profileOf(moved.sim, moved.citizen);

    expect(profile.householdName).toMatch(/ household$/);
    expect(profile.members).toHaveLength(3);
    expect(profile.members.map((member) => member.id)).toEqual([0, 1, 2]);
    expect(new Set(profile.members.map((member) => member.givenName)).size).toBe(3);
    for (const member of profile.members) {
      expect(member.givenName.length).toBeGreaterThan(0);
      expect(member.age).toBeGreaterThanOrEqual(0);
      expect(member.lifeStage.length).toBeGreaterThan(0);
      expect(member.education.length).toBeGreaterThan(0);
      expect(member.role.length).toBeGreaterThan(0);
    }
    expect(citizen.travellerMemberId).toBe(profile.primaryWorkerMemberId);
    expect(lifeEventsOf(moved.sim, moved.citizen)).toEqual([
      expect.objectContaining({
        kind: 'movedIn',
        tick: moved.sim.world.tick,
        memberId: profile.primaryWorkerMemberId,
        place: moved.home,
      }),
    ]);
    expect(citizenDetail(moved.sim, moved.citizen)).toEqual(
      expect.objectContaining({
        historyComplete: true,
        historyStartTick: moved.sim.world.tick,
      }),
    );

    const baseline = createCitySim({ seed: 31 });
    const base = findLandBlock(baseline, 3, 3);
    seedBuilding(baseline, { x: base.x, y: base.y, zone: 'R' });
    let nextAfterManualHomePick = -1;
    baseline.world.runMaintenance(() => {
      baseline.world.random();
      nextAfterManualHomePick = baseline.world.random();
    });
    let nextAfterMoveIn = -1;
    moved.sim.world.runMaintenance(() => {
      nextAfterMoveIn = moved.sim.world.random();
    });
    expect(nextAfterMoveIn).toBe(nextAfterManualHomePick);
  });

  it('generates the same profile from stable simulation identity', () => {
    const first = moveInTown(43);
    const second = moveInTown(43);
    expect(profileOf(first.sim, first.citizen)).toEqual(profileOf(second.sim, second.citizen));
    expect(lifeEventsOf(first.sim, first.citizen)).toEqual(
      lifeEventsOf(second.sim, second.citizen),
    );
  });

  it('derives a stable three-person fallback for a legacy snapshot', () => {
    const { sim, citizen } = moveInTown(47);
    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const components = snapshot.components as Record<
      string,
      Array<[number, Record<string, unknown>]>
    >;
    delete components.citizenProfile;
    delete components.citizenLife;
    for (const [, data] of components.citizen) {
      delete data.travellerMemberId;
    }

    const restored = createCitySim({ seed: 47 });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);
    const legacy = citizenOf(restored, citizen);
    expect(restored.world.getComponent(citizen, 'citizenProfile')).toBeUndefined();
    expect(restored.world.getComponent(citizen, 'citizenLife')).toBeUndefined();
    const serializedBeforeRead = JSON.stringify(restored.world.serialize());
    const profile = profileForCitizen(restored, citizen, legacy);
    expect(profile.members).toHaveLength(3);
    expect(profile).toEqual(profileForCitizen(restored, citizen, legacy));

    const detail = citizenDetail(restored, citizen);
    expect(detail?.profileSource).toBe('legacyFallback');
    expect(detail?.profile).toEqual(profile);
    expect(detail?.lifeEvents).toEqual([]);
    expect(detail?.travellerMemberId).toBe(
      travellerForActivity(profile, detail?.activity ?? 'work'),
    );
    expect(JSON.stringify(restored.world.serialize())).toBe(serializedBeforeRead);
    expect(restored.world.getComponent(citizen, 'citizenProfile')).toBeUndefined();
    expect(restored.world.getComponent(citizen, 'citizenLife')).toBeUndefined();

    const control = createCitySim({ seed: 47 });
    control.world.applySnapshot(JSON.parse(JSON.stringify(snapshot)));
    rebuildDerived(control);
    let nextAfterRead = -1;
    let nextWithoutRead = -1;
    restored.world.runMaintenance(() => {
      nextAfterRead = restored.world.random();
    });
    control.world.runMaintenance(() => {
      nextWithoutRead = control.world.random();
    });
    expect(nextAfterRead).toBe(nextWithoutRead);
  });

  it('derives an employed legacy worker role and preserves incomplete-history provenance after storage', () => {
    const { sim, work, citizen } = employmentTown();
    sim.world.runMaintenance(() => {
      sim.world.removeComponent(citizen, 'citizenProfile');
      sim.world.removeComponent(citizen, 'citizenLife');
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.work = work;
      });
    });

    const legacy = citizenDetail(sim, citizen)!;
    expect(legacy.profileSource).toBe('legacyFallback');
    expect(legacy.profile.members.find(
      (member) => member.id === legacy.profile.primaryWorkerMemberId,
    )?.role).toBe('industrialWorker');
    expect(legacy.historyComplete).toBe(false);
    expect(legacy.historyStartTick).toBeNull();

    sim.world.runMaintenance(() => unassignWorkers(sim, sim.world, work));
    const materialized = citizenDetail(sim, citizen)!;
    expect(materialized.profileSource).toBe('stored');
    expect(materialized.historyComplete).toBe(false);
    expect(materialized.historyStartTick).toBe(sim.world.tick);
    expect(materialized.lifeEvents).toEqual([
      expect.objectContaining({ kind: 'jobLost', tick: sim.world.tick }),
    ]);

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: sim.seed });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);
    expect(citizenDetail(restored, citizen)).toEqual(
      expect.objectContaining({
        profileSource: 'stored',
        historyComplete: false,
        historyStartTick: sim.world.tick,
      }),
    );
  });

  it('rejects malformed stored profiles without throwing or accepting partial person data', () => {
    const { sim, home, citizen } = moveInTown(51);
    const valid = createCitizenProfile(
      sim.seed,
      citizen,
      sim.world.getEntityGeneration(citizen),
      home,
    );
    const malformed = [
      { ...valid, householdName: '' },
      { ...valid, members: null },
      {
        ...valid,
        members: valid.members.map((member, index) =>
          index === 1 ? { ...member, id: 0 } : member,
        ),
      },
      {
        ...valid,
        members: valid.members.map((member, index) =>
          index === 2 ? { ...member, lifeStage: 'ancient' } : member,
        ),
      },
      {
        ...valid,
        members: valid.members.map((member, index) =>
          index === 0 ? { ...member, givenName: '' } : member,
        ),
      },
      { ...valid, primaryWorkerMemberId: 99 },
    ] as unknown as CitizenProfile[];

    for (const candidate of malformed) {
      expect(() => hasStoredCitizenProfile(candidate)).not.toThrow();
      expect(hasStoredCitizenProfile(candidate)).toBe(false);
    }

    sim.world.runMaintenance(() => {
      sim.world.setComponent(citizen, 'citizenProfile', malformed[1]);
    });
    expect(profileForCitizen(sim, citizen, citizenOf(sim, citizen))).toEqual(valid);
  });

  it('keeps the selected person stable when another member starts travelling', () => {
    const { sim, citizen } = moveInTown(49);
    const selectedBefore = citizenDetail(sim, citizen, 1);
    expect(selectedBefore?.selectedMember.id).toBe(1);

    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.travellerMemberId = 2;
      });
    });
    const selectedAfter = citizenDetail(sim, citizen, 1);
    expect(selectedAfter?.selectedMember.id).toBe(1);
    expect(selectedAfter?.activeTraveller.id).toBe(2);
    expect(selectedAfter?.activeTravellerMemberId).toBe(2);
  });

  it('records hiring and job loss while keeping the named worker role honest', () => {
    const { sim, work, citizen } = employmentTown();
    sim.world.runMaintenance(() => employmentSystem(sim)(sim.world));

    const hired = citizenOf(sim, citizen);
    expect(hired.work).toBe(work);
    const profile = profileOf(sim, citizen);
    expect(profile.members.find((member) => member.id === profile.primaryWorkerMemberId)?.role).toBe(
      'industrialWorker',
    );
    expect(lifeEventsOf(sim, citizen).at(-1)).toEqual(
      expect.objectContaining({
        kind: 'hired',
        memberId: profile.primaryWorkerMemberId,
        place: work,
      }),
    );

    sim.world.runMaintenance(() => unassignWorkers(sim, sim.world, work));
    const jobless = citizenOf(sim, citizen);
    expect(jobless.work).toBeNull();
    expect(
      profileOf(sim, citizen).members.find(
        (member) => member.id === profileOf(sim, citizen).primaryWorkerMemberId,
      )?.role,
    ).toBe('jobSeeker');
    expect(lifeEventsOf(sim, citizen).at(-1)).toEqual(
      expect.objectContaining({ kind: 'jobLost', place: work }),
    );
  });

  it('caps the life trail at the newest meaningful events', () => {
    const { sim, citizen } = moveInTown(53);
    for (let place = 0; place < CITIZEN_LIFE_EVENT_LIMIT + 4; place++) {
      sim.world.runMaintenance(() => {
        appendCitizenLifeEvent(sim.world, citizen, {
          kind: 'outingDeparted',
          memberId: place % 3,
          place,
          activity: 'leisure',
        });
      });
      sim.world.step();
    }
    const events = lifeEventsOf(sim, citizen);
    expect(events).toHaveLength(CITIZEN_LIFE_EVENT_LIMIT);
    expect(events[0].place).toBe(4);
    expect(events.at(-1)?.place).toBe(CITIZEN_LIFE_EVENT_LIMIT + 3);
    expect(citizenDetail(sim, citizen)).toEqual(
      expect.objectContaining({
        historyComplete: false,
        historyStartTick: 4,
        historyTruncated: true,
      }),
    );
  });

  it('sanitizes malformed life history and keeps query and append output bounded', () => {
    const { sim, citizen } = moveInTown(55);
    const malformedEvents: unknown[] = [null];
    for (let tick = 0; tick < CITIZEN_LIFE_EVENT_LIMIT + 4; tick++) {
      malformedEvents.push({
        kind: tick === 0 ? 'outing' : 'stranded',
        tick,
        memberId: tick % 3,
        activity: 'leisure',
      });
      sim.world.step();
    }
    sim.world.runMaintenance(() => {
      sim.world.setComponent(citizen, 'citizenLife', {
        events: malformedEvents,
        historyComplete: true,
      } as unknown as CitizenLifeComponent);
    });

    const beforeAppend = citizenDetail(sim, citizen)!;
    expect(beforeAppend.lifeEvents).toHaveLength(CITIZEN_LIFE_EVENT_LIMIT);
    expect(beforeAppend.lifeEvents[0]?.tick).toBe(4);
    expect(beforeAppend.historyComplete).toBe(false);
    expect(beforeAppend.historyTruncated).toBe(true);
    expect(beforeAppend.historyStartTick).toBe(4);

    expect(() => {
      sim.world.runMaintenance(() => {
        appendCitizenLifeEvent(sim.world, citizen, {
          kind: 'stranded',
          memberId: 0,
          activity: 'work',
        });
      });
    }).not.toThrow();
    const afterAppend = citizenDetail(sim, citizen)!;
    expect(afterAppend.lifeEvents).toHaveLength(CITIZEN_LIFE_EVENT_LIMIT);
    expect(afterAppend.lifeEvents[0]?.tick).toBe(5);
    expect(afterAppend.lifeEvents.at(-1)?.tick).toBe(sim.world.tick);
    expect(afterAppend.historyStartTick).toBe(5);
    expect(afterAppend.historyTruncated).toBe(true);
  });

  it('recovers from a non-array life history without claiming a complete biography', () => {
    const { sim, citizen } = moveInTown(56);
    sim.world.runMaintenance(() => {
      sim.world.setComponent(citizen, 'citizenLife', {
        events: { corrupt: true },
        historyComplete: true,
      } as unknown as CitizenLifeComponent);
    });

    const malformed = citizenDetail(sim, citizen)!;
    expect(malformed.lifeEvents).toEqual([]);
    expect(malformed.historyComplete).toBe(false);
    expect(malformed.historyStartTick).toBeNull();
    expect(malformed.historyTruncated).toBe(true);

    expect(() => {
      sim.world.runMaintenance(() => {
        appendCitizenLifeEvent(sim.world, citizen, {
          kind: 'stranded',
          memberId: 0,
          activity: 'work',
        });
      });
    }).not.toThrow();
    expect(citizenDetail(sim, citizen)).toEqual(
      expect.objectContaining({
        lifeEvents: [expect.objectContaining({ kind: 'stranded', memberId: 0 })],
        historyComplete: false,
        historyStartTick: sim.world.tick,
        historyTruncated: true,
      }),
    );
  });

  it('returns a detached profile so inspection cannot mutate ECS state invisibly', () => {
    const { sim, citizen } = moveInTown(57);
    const serialized = JSON.stringify(sim.world.serialize());
    const stored = structuredClone(profileOf(sim, citizen));
    const detail = citizenDetail(sim, citizen)!;

    detail.profile.householdName = 'Mutated household';
    detail.profile.members[0].givenName = 'Mutated';
    detail.selectedMember.role = 'retired';

    expect(profileOf(sim, citizen)).toEqual(stored);
    expect(JSON.stringify(sim.world.serialize())).toBe(serialized);
  });

  it('records a stranding against the person who was travelling', () => {
    const { sim, citizen } = moveInTown(59);
    const profile = profileOf(sim, citizen);
    const traveller = travellerForActivity(profile, 'leisure');
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.nextActivity = 'leisure';
        data.travellerMemberId = traveller;
      });
      markStranded(sim.world, citizen);
    });
    expect(lifeEventsOf(sim, citizen).at(-1)).toEqual(
      expect.objectContaining({ kind: 'stranded', memberId: traveller }),
    );
  });
});

describe('profile consequences', () => {
  it('lets household life stages materially shape free-time weights', () => {
    const { sim, home, citizen } = employmentTown();
    const base = createCitizenProfile(
      sim.seed,
      citizen,
      sim.world.getEntityGeneration(citizen),
      home,
    );
    const young = stagedProfile(base, ['adult', 'child', 'teen']);
    const older = stagedProfile(base, ['adult', 'senior', 'senior']);

    setProfile(sim, citizen, young);
    const youngWeights = freeTimeWeights(sim.world, citizenOf(sim, citizen), young);
    setProfile(sim, citizen, older);
    const olderWeights = freeTimeWeights(sim.world, citizenOf(sim, citizen), older);

    expect(youngWeights.leisure).toBeGreaterThan(olderWeights.leisure);
    expect(olderWeights.rest).toBeGreaterThan(youngWeights.rest);
  });

  it('keeps work, errands, and leisure attached to stable named travellers', () => {
    const { sim, home, citizen } = employmentTown();
    const profile = stagedProfile(
      createCitizenProfile(
        sim.seed,
        citizen,
        sim.world.getEntityGeneration(citizen),
        home,
      ),
      ['adult', 'adult', 'child'],
    );
    expect(travellerForActivity(profile, 'work')).toBe(profile.primaryWorkerMemberId);
    expect(travellerForActivity(profile, 'shop')).toBe(1);
    expect(travellerForActivity(profile, 'leisure')).toBe(2);
    expect(travellerForActivity(profile, 'leisure')).toBe(
      travellerForActivity(profile, 'leisure'),
    );
  });

  it('stores the selected person and an outing event when a walker leaves', () => {
    const { sim, home, citizen } = employmentTown();
    const shopPosition = sim.world.getComponent(home, 'position')!;
    const shop = seedBuilding(sim, {
      x: shopPosition.x + 3,
      y: shopPosition.y,
      zone: 'C',
      jobsFilled: 1,
    });
    refreshOccupancy(sim);
    const original = profileOf(sim, citizen);
    const profile = stagedProfile(original, ['adult', 'adult', 'child']);
    setProfile(sim, citizen, profile);
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.work = shop;
        data.nextActivity = 'leisure';
      });
    });

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toShop', 64);
    const travelling = citizenOf(sim, citizen);
    expect(travelling.travellerMemberId).toBe(2);
    expect(lifeEventsOf(sim, citizen).at(-1)).toEqual(
      expect.objectContaining({
        kind: 'outingDeparted',
        memberId: 2,
        activity: 'leisure',
        place: travelling.shop,
      }),
    );

    const before = citizenDetail(sim, citizen, 2)!;
    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: sim.seed });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);
    const after = citizenDetail(restored, citizen, 2)!;
    expect(after.profile).toEqual(before.profile);
    expect(after.lifeEvents).toEqual(before.lifeEvents);
    expect(after.selectedMember).toEqual(before.selectedMember);
    expect(after.activeTraveller).toEqual(before.activeTraveller);
    expect(after.agent?.kind).toBe('pedestrian');
    const restoredPath = [...restored.world.query('pedestrianPath')]
      .map((id) => restored.world.getComponent(id, 'pedestrianPath'))
      .find((path) => path?.citizen === citizen);
    expect(restoredPath?.memberId).toBe(2);

    let reachedReturnLeg = false;
    for (let tick = 0; tick < 2_000; tick++) {
      if (
        citizenOf(sim, citizen).phase === 'toHome' &&
        citizenOf(restored, citizen).phase === 'toHome'
      ) {
        reachedReturnLeg = true;
        break;
      }
      sim.world.step();
      restored.world.step();
    }
    expect(reachedReturnLeg, 'original/restored outing did not reach the return leg together').toBe(
      true,
    );
    const continued = citizenDetail(sim, citizen, 2)!;
    const restoredContinued = citizenDetail(restored, citizen, 2)!;
    expect(restoredContinued.selectedMember).toEqual(continued.selectedMember);
    expect(restoredContinued.activeTraveller).toEqual(continued.activeTraveller);
    expect(restoredContinued.lifeEvents).toEqual(continued.lifeEvents);
    expect(restoredContinued.agent?.kind).toBe('pedestrian');
    expect(
      [...restored.world.query('pedestrianPath')]
        .map((id) => restored.world.getComponent(id, 'pedestrianPath'))
        .find((path) => path?.citizen === citizen)?.memberId,
    ).toBe(2);
  });

  it('keeps rest observable with its senior representative until work begins', () => {
    const { sim, home, citizen } = employmentTown();
    const profile = stagedProfile(
      createCitizenProfile(
        sim.seed,
        citizen,
        sim.world.getEntityGeneration(citizen),
        home,
      ),
      ['adult', 'adult', 'senior'],
    );
    setProfile(sim, citizen, profile);
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.work = home;
        data.nextActivity = 'rest';
      });
    });

    stepUntil(
      sim,
      () => (citizenOf(sim, citizen).restUntil ?? -1) > sim.world.tick,
      32,
    );
    const resting = citizenOf(sim, citizen);
    expect(resting.nextActivity).toBe('work');
    expect(resting.travellerMemberId).toBe(2);
    const detail = citizenDetail(sim, citizen, 2)!;
    expect(detail.activity).toBe('rest');
    expect(detail.activeTravellerMemberId).toBe(2);
    expect(detail.agent).toBeNull();
    expect(detail.status).toMatch(/^Resting at home/);
  });

  it('keeps the senior as the resting person when the household loses its job', () => {
    const { sim, home, work, citizen } = employmentTown();
    const base = stagedProfile(
      createCitizenProfile(
        sim.seed,
        citizen,
        sim.world.getEntityGeneration(citizen),
        home,
      ),
      ['adult', 'adult', 'senior'],
    );
    const profile: CitizenProfile = {
      ...base,
      members: base.members.map((member) =>
        member.id === base.primaryWorkerMemberId
          ? { ...member, role: 'industrialWorker' }
          : member,
      ),
    };
    setProfile(sim, citizen, profile);
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.work = work;
        data.nextActivity = 'rest';
      });
    });
    stepUntil(
      sim,
      () => (citizenOf(sim, citizen).restUntil ?? -1) > sim.world.tick,
      32,
    );
    const restEnd = citizenOf(sim, citizen).restUntil;

    sim.world.runMaintenance(() => unassignWorkers(sim, sim.world, work));

    const citizenData = citizenOf(sim, citizen);
    const detail = citizenDetail(sim, citizen, 2)!;
    expect(citizenData.work).toBeNull();
    expect(citizenData.restUntil).toBe(restEnd);
    expect(citizenData.travellerMemberId).toBe(2);
    expect(detail.activity).toBe('rest');
    expect(detail.activeTravellerMemberId).toBe(2);
    expect(detail.profile.members[0]?.role).toBe('jobSeeker');
    expect(detail.status).toMatch(/^Resting at home/);
  });

});
