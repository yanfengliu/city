import { describe, expect, it, vi } from 'vitest';
import {
  MAX_HAPPINESS_REASONS,
  citizenInspectData,
  moodWord,
} from '../../src/app/citizen-inspect';
import type { CitizenDetail, CitizenPlace } from '../../src/protocol/messages';
import type { CitizenLifeEvent, CitizenMemberProfile } from '../../src/sim/types';

function place(overrides: Partial<CitizenPlace> = {}): CitizenPlace {
  return {
    entity: 1,
    generation: 1,
    x: 12,
    y: 40,
    cell: 0,
    zone: 'R',
    level: 2,
    abandoned: false,
    w: 2,
    h: 2,
    ...overrides,
  };
}

const alex: CitizenMemberProfile = {
  id: 0,
  givenName: 'Alex',
  age: 38,
  lifeStage: 'adult',
  education: 'university',
  role: 'industrialWorker',
};
const chloe: CitizenMemberProfile = {
  id: 1,
  givenName: 'Chloe',
  age: 35,
  lifeStage: 'adult',
  education: 'trade',
  role: 'caregiver',
};
const eli: CitizenMemberProfile = {
  id: 2,
  givenName: 'Eli',
  age: 9,
  lifeStage: 'child',
  education: 'primary',
  role: 'child',
};

function detail(overrides: Partial<CitizenDetail> = {}): CitizenDetail {
  return {
    entity: 7,
    generation: 1,
    profile: {
      version: 1,
      householdName: 'Adams household',
      members: [alex, chloe, eli],
      primaryWorkerMemberId: 0,
    },
    profileSource: 'stored',
    historyComplete: true,
    historyStartTick: 0,
    activeTravellerMemberId: 1,
    activeTraveller: chloe,
    selectedMemberId: 0,
    selectedMember: alex,
    travellerMemberId: 1,
    traveller: chloe,
    lifeEvents: [
      { kind: 'movedIn', tick: 0, memberId: 0, place: 1, placeGeneration: 1 },
      {
        kind: 'outingDeparted' as CitizenLifeEvent['kind'],
        tick: 4097,
        memberId: 1,
        activity: 'shop',
        place: 2,
      },
    ],
    happiness: 0.72,
    breakdown: {
      score: 0.72,
      base: 0.5,
      raw: 0.72,
      factors: [
        { id: 'power', label: 'Home has power', delta: 0.08 },
        { id: 'water', label: 'Home has water', delta: 0.08 },
        { id: 'employment', label: 'Works at the industrial job', delta: 0.1 },
        { id: 'commute', label: 'Commute 34 cells home to work', delta: -0.05 },
        { id: 'services', label: 'no service covers home (0 of 4)', delta: 0 },
      ],
    },
    phase: 'toWork',
    activity: 'work',
    status: 'Walking to the industrial job at (44, 31)',
    home: place(),
    work: place({ entity: 2, x: 44, y: 31, zone: 'I', level: 1 }),
    destination: place({ entity: 2, x: 44, y: 31, zone: 'I', level: 1 }),
    activityPlace: null,
    agent: { kind: 'pedestrian', entity: 99, generation: 3 },
    x: 20,
    y: 40,
    cell: 0,
    waitUntil: 0,
    strandedAt: null,
    commuteCells: 34,
    ...overrides,
  };
}

function section(detailOverride: Partial<CitizenDetail>, heading: string): string[] {
  const match = citizenInspectData(detail(detailOverride)).sections?.find(
    (candidate) => candidate.heading === heading,
  );
  if (!match) throw new Error(`citizen inspector did not render the ${heading} section`);
  return match.lines;
}

describe('moodWord', () => {
  it('names each band and clamps out-of-range scores', () => {
    expect(moodWord(0.95)).toBe('thriving');
    expect(moodWord(0.7)).toBe('content');
    expect(moodWord(0.5)).toBe('coping');
    expect(moodWord(0.3)).toBe('unhappy');
    expect(moodWord(0.05)).toBe('miserable');
    expect(moodWord(2)).toBe('thriving');
    expect(moodWord(-1)).toBe('miserable');
  });
});

describe('citizenInspectData', () => {
  it('leads with the selected named resident and honest household happiness', () => {
    const data = citizenInspectData(detail());
    expect(data.title).toBe('Alex — Adams household');
    expect(data.meter).toEqual({
      label: 'Household happiness',
      value: 0.72,
      caption: '72% — content',
    });
    expect(section({}, 'Selected resident')).toEqual([
      'Age 38 · Adult',
      'Industrial worker · University education',
      'Chloe is the active traveller; Alex remains selected.',
    ]);
  });

  it('distinguishes selection from travel and states the one-trip simulation boundary', () => {
    const lines = section({}, 'Current activity');
    expect(lines[0]).toBe('Household now: Walking to the industrial job at (44, 31)');
    expect(lines).toContain('Travel mode: Walking');
    expect(lines).toContain('Current map position: (20, 40)');
    expect(lines).toContain(
      'One household trip is simulated at a time; Chloe represents this activity.',
    );
  });

  it('uses activity-representative wording when nobody is travelling', () => {
    const idle = detail({ agent: null, phase: 'home', activity: 'rest' });
    const selected = citizenInspectData(idle).sections?.find(
      (candidate) => candidate.heading === 'Selected resident',
    )?.lines ?? [];
    const members = citizenInspectData(idle).sections?.find(
      (candidate) => candidate.heading === 'Household members (3)',
    )?.lines ?? [];
    const activity = citizenInspectData(idle).sections?.find(
      (candidate) => candidate.heading === 'Current activity',
    )?.lines ?? [];

    expect(selected.at(-1)).toBe(
      'Chloe represents the current activity; Alex remains selected and nobody is travelling.',
    );
    expect(members[1]).toContain('(activity representative)');
    expect(activity).toContain('Travel mode: No walker or car is active');
    expect(activity).toContain(
      'Household activities are simulated one at a time; Chloe represents this one.',
    );
    expect(activity.join(' ')).not.toContain('active traveller');
  });

  it('lists all three residents with selected and traveller markers', () => {
    const lines = section({}, 'Household members (3)');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'Alex, 38 — Adult · Industrial worker · University education (selected)',
    );
    expect(lines[1]).toContain('(active traveller)');
    expect(lines[2]).toBe('Eli, 9 — Child · Child · Primary education');
  });

  it('shows home, work, active destination, and commute', () => {
    const lines = section({}, 'Places & commute');
    expect(lines).toEqual([
      'Map markers: cyan home / orange work / magenta current destination or venue',
      'Home: Residential level 2 at (12, 40)',
      'Work: Industrial level 1 at (44, 31)',
      'Destination: Industrial level 1 at (44, 31)',
      'Activity venue: No active outing venue',
      'Commute: 34 cells each way',
    ]);
  });

  it('names a service destination and venue with map coordinates', () => {
    const park = {
      entity: 9,
      generation: 2,
      x: 50,
      y: 60,
      w: 2,
      h: 2,
      kind: 'service' as const,
      label: 'Park',
    };
    const lines = section(
      { destination: null, destinationPlace: park, activityPlace: park },
      'Places & commute',
    );

    expect(lines).toContain('Destination: Park at (50, 60)');
    expect(lines).toContain('Activity venue: Park at (50, 60)');
  });

  it('explains the score with its strongest factors, biggest first', () => {
    const reasons = section({}, 'Household happiness reasons');
    expect(reasons).toHaveLength(MAX_HAPPINESS_REASONS);
    expect(reasons[0]).toBe('+10 Works at the industrial job');
    expect(reasons).toContain('+8 Home has power');
    expect(reasons.every((line) => !line.includes('Commute'))).toBe(true);
    expect(reasons.some((line) => line.includes('0 of 4'))).toBe(false);
  });

  it('surfaces dominant problems with minus signs', () => {
    const reasons = section(
      {
        happiness: 0.18,
        breakdown: {
          score: 0.18,
          base: 0.5,
          raw: 0.18,
          factors: [
            { id: 'power', label: 'Home at (12, 40) has no power', delta: -0.22 },
            { id: 'water', label: 'Home at (12, 40) has no water', delta: -0.22 },
            { id: 'employment', label: 'No job', delta: -0.15 },
          ],
        },
      },
      'Household happiness reasons',
    );
    expect(reasons[0]).toBe('−22 Home at (12, 40) has no power');
    expect(reasons.every((line) => line.startsWith('−'))).toBe(true);
  });

  it('shows newest life events first with both day and exact tick context', () => {
    const lines = section({}, 'Recent life');
    expect(lines).toEqual([
      'Day 2 · tick 4097 — Chloe left home to go shopping.',
      'Day 1 · tick 0 — Alex moved into the city.',
    ]);
  });

  it('warns when identity came from a legacy save without invented history', () => {
    const data = citizenInspectData(
      detail({
        profileSource: 'legacyFallback',
        historyComplete: false,
        historyStartTick: 2048,
        lifeEvents: [],
      }),
    );
    expect(data.sections?.[0]).toEqual({
      heading: 'Record provenance',
      lines: [
        'Names were reconstructed deterministically from this legacy save.',
        'Life events before tick 2048 are unavailable.',
      ],
    });
    expect(section({
      profileSource: 'legacyFallback',
      historyComplete: false,
      historyStartTick: 2048,
      lifeEvents: [],
    }, 'Recent life')).toEqual(['No recorded life events yet.']);
  });

  it('keeps the partial-history warning after a legacy profile becomes stored', () => {
    const data = citizenInspectData(detail({
      profileSource: 'stored',
      historyComplete: false,
      historyStartTick: null,
    }));

    expect(data.sections?.[0]).toEqual({
      heading: 'Record provenance',
      lines: ['Life events from before this save was upgraded are unavailable.'],
    });
  });

  it('explains when the bounded biography no longer reaches move-in', () => {
    const data = citizenInspectData(detail({
      historyComplete: false,
      historyStartTick: 4096,
      historyTruncated: true,
    }));

    expect(data.sections?.[0]).toEqual({
      heading: 'Record provenance',
      lines: [
        'Only the newest valid life events are retained; earlier history before tick 4096 is unavailable.',
      ],
    });
  });

  it('handles unemployment, no active trip, and a lost home explicitly', () => {
    const noPlaces = detail({
      home: null,
      work: null,
      destination: null,
      commuteCells: null,
      agent: null,
    });
    const data = citizenInspectData(noPlaces);
    expect(data.abandoned).toBe(true);
    expect(data.lines).toContain('Home: No home — the household lost its residence');
    expect(data.lines).toContain('Work: No workplace assigned');
    expect(data.lines).toContain('Destination: No active destination');
    expect(data.lines).toContain('Commute: none — no workplace is assigned');
    expect(data.lines).toContain('Travel mode: No walker or car is active');
  });

  it('forwards app-owned Meet or Next actions without invoking them', () => {
    const onClick = vi.fn();
    const actions = [{ label: 'Next resident', onClick }];
    const data = citizenInspectData(detail(), actions);
    expect(data.actions).toBe(actions);
    expect(onClick).not.toHaveBeenCalled();
    data.actions?.[0].onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
