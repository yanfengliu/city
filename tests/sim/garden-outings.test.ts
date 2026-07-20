import { describe, expect, it } from 'vitest';
import { citizenDetail } from '../../src/sim/citizen-detail';
import {
  createCitizenProfile,
  travellerForLeisureVenue,
} from '../../src/sim/citizen-profile';
import type {
  CitizenEducation,
  CitizenLifeStage,
  CitizenMemberProfile,
  CitizenProfile,
} from '../../src/sim/types';
import {
  FAR_GARDEN,
  FAR_PARK,
  NEAR_GARDEN,
  NEAR_PARK,
  outingPick,
  parkTown,
  setTownProfile,
  type ParkTown,
} from './park-town';
import { agentsFor, citizenOf, stepUntil } from './helpers';

describe('community-garden leisure outings', () => {
  it('lets household composition choose between parks and gardens', () => {
    const youngTown = parkTown({
      seed: 41,
      parkOffsets: [NEAR_PARK],
      gardenOffsets: [NEAR_GARDEN],
    });
    setTownProfile(youngTown, profileWithStages(youngTown, ['adult', 'child', 'senior']));
    expect(outingPick(youngTown, 'leisure')).toBe(youngTown.parks[0]);

    const olderTown = parkTown({
      seed: 41,
      parkOffsets: [NEAR_PARK],
      gardenOffsets: [NEAR_GARDEN],
    });
    setTownProfile(olderTown, profileWithStages(olderTown, ['adult', 'adult', 'senior']));
    expect(outingPick(olderTown, 'leisure')).toBe(olderTown.gardens[0]);
  });

  it('falls through to the other green venue, then shops, when preference is unavailable', () => {
    const olderTown = parkTown({
      seed: 43,
      parkOffsets: [NEAR_PARK],
      gardenOffsets: [FAR_GARDEN],
    });
    setTownProfile(olderTown, profileWithStages(olderTown, ['adult', 'adult', 'senior']));
    expect(outingPick(olderTown, 'leisure')).toBe(olderTown.parks[0]);

    const youngTown = parkTown({
      seed: 43,
      parkOffsets: [FAR_PARK],
      gardenOffsets: [NEAR_GARDEN],
    });
    setTownProfile(youngTown, profileWithStages(youngTown, ['adult', 'child', 'senior']));
    expect(outingPick(youngTown, 'leisure')).toBe(youngTown.gardens[0]);

    const noGreenInReach = parkTown({ seed: 43, gardenOffsets: [FAR_GARDEN] });
    setTownProfile(
      noGreenInReach,
      profileWithStages(noGreenInReach, ['adult', 'adult', 'senior']),
    );
    expect(noGreenInReach.shops).toContain(outingPick(noGreenInReach, 'leisure'));
  });

  it('uses a senior for a garden visit and the youngest person for a park visit', () => {
    const town = parkTown();
    const profile = profileWithStages(town, ['adult', 'child', 'senior']);
    expect(travellerForLeisureVenue(profile, 'park')).toBe(1);
    expect(travellerForLeisureVenue(profile, 'garden')).toBe(2);

    const allAdults: CitizenProfile = {
      ...profile,
      members: profile.members.map((member, index) => ({
        ...member,
        age: [44, 61, 37][index],
        lifeStage: 'adult' as const,
        role: index === 0 ? ('jobSeeker' as const) : ('caregiver' as const),
      })),
    };
    expect(travellerForLeisureVenue(allAdults, 'garden')).toBe(1);
  });

  it('walks to a garden, names it, records no sale, and comes home', () => {
    const town = parkTown({
      seed: 47,
      activity: 'leisure',
      gardenOffsets: [NEAR_GARDEN],
    });
    const { sim, citizen } = town;
    setTownProfile(town, profileWithStages(town, ['adult', 'adult', 'senior']));

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toShop', 64);
    expect(citizenOf(sim, citizen).shop).toBe(town.gardens[0]);
    expect(citizenOf(sim, citizen).travellerMemberId).toBe(2);
    const walker = agentsFor(sim, citizen)[0];
    expect(sim.world.getComponent(walker, 'pedestrianPath')?.memberId).toBe(2);
    expect(citizenDetail(sim, citizen)?.status).toContain('the community garden at');
    expect(citizenDetail(sim, citizen)?.destinationPlace).toEqual(
      expect.objectContaining({
        entity: town.gardens[0],
        kind: 'service',
        label: 'community garden',
      }),
    );

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'atShop', 2_000);
    expect(sim.world.getState('completedShoppingTrips')).toBe(0);
    expect(sim.world.getState('pendingRetailVisits')).toBe(0);
    expect(citizenDetail(sim, citizen)?.status).toContain('community garden');

    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'home', 2_000);
    expect(citizenOf(sim, citizen).nextActivity).toBe('work');
    expect(citizenOf(sim, citizen).shop).toBeNull();
    expect(sim.world.getState('disconnectedTrips')).toBe(0);
  });

  it('recovers cleanly when a garden is bulldozed during a visit', () => {
    const town = parkTown({
      seed: 53,
      activity: 'leisure',
      gardenOffsets: [NEAR_GARDEN],
    });
    setTownProfile(town, profileWithStages(town, ['adult', 'adult', 'senior']));
    stepUntil(town.sim, () => citizenOf(town.sim, town.citizen).phase === 'atShop', 2_000);

    expect(
      town.sim.world.submit('bulldozeRect', {
        ax: town.base.x + NEAR_GARDEN,
        ay: town.streetY - 2,
        bx: town.base.x + NEAR_GARDEN + 1,
        by: town.streetY - 1,
      }),
    ).toBe(true);
    town.sim.world.step();

    stepUntil(town.sim, () => citizenOf(town.sim, town.citizen).phase === 'home', 2_000);
    expect(agentsFor(town.sim, town.citizen)).toHaveLength(0);
    expect(citizenOf(town.sim, town.citizen).shop).toBeNull();
  });
});

function profileWithStages(
  town: ParkTown,
  stages: [CitizenLifeStage, CitizenLifeStage, CitizenLifeStage],
): CitizenProfile {
  const profile = createCitizenProfile(
    town.sim.seed,
    town.citizen,
    town.sim.world.getEntityGeneration(town.citizen),
    town.home,
  );
  const ageFor = (stage: CitizenLifeStage): number => {
    if (stage === 'child') return 9;
    if (stage === 'teen') return 16;
    if (stage === 'senior') return 73;
    return 39;
  };
  const educationFor = (stage: CitizenLifeStage): CitizenEducation => {
    if (stage === 'child') return 'primary';
    if (stage === 'teen') return 'secondary';
    return 'trade';
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
