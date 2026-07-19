import { describe, expect, it } from 'vitest';
import {
  MAX_HAPPINESS_REASONS,
  citizenInspectData,
  moodWord,
} from '../../src/app/citizen-inspect';
import type { CitizenDetail, CitizenPlace } from '../../src/protocol/messages';

function place(overrides: Partial<CitizenPlace> = {}): CitizenPlace {
  return { entity: 1, x: 12, y: 40, cell: 0, zone: 'R', level: 2, abandoned: false, ...overrides };
}

function detail(overrides: Partial<CitizenDetail> = {}): CitizenDetail {
  return {
    entity: 7,
    generation: 1,
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
    agent: { kind: 'pedestrian', entity: 99, generation: 3 },
    x: 20,
    y: 40,
    cell: 0,
    waitUntil: 0,
    strandedAt: null,
    commuteCells: 34,
    ...overrides,
  } as CitizenDetail;
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
  it('leads with the happiness meter, as a percentage and a word', () => {
    const data = citizenInspectData(detail());
    expect(data.meter).toBeDefined();
    expect(data.meter!.value).toBe(0.72);
    expect(data.meter!.caption).toBe('72% — content');
  });

  it('says what they are doing and where they live and work', () => {
    const lines = citizenInspectData(detail()).lines;
    expect(lines[0]).toBe('Walking to the industrial job at (44, 31)');
    expect(lines.some((l) => l.startsWith('Lives at (12, 40)'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Works at (44, 31)'))).toBe(true);
    expect(lines.some((l) => l === 'Commute: 34 cells each way')).toBe(true);
    expect(lines).toContain('Currently walking');
  });

  it('explains the score with its strongest factors, biggest first', () => {
    const lines = citizenInspectData(detail()).lines;
    const reasons = lines.filter((l) => l.startsWith('  '));
    expect(reasons.length).toBe(MAX_HAPPINESS_REASONS);
    // Ranked by magnitude: employment (+10), then power and water (+8 each).
    // Commute (−5) is the weakest and is correctly cut.
    expect(reasons[0]).toContain('+10');
    expect(reasons[0]).toContain('industrial job');
    expect(reasons.every((l) => !l.includes('Commute'))).toBe(true);
    // A zero-delta factor explains nothing and must not take a slot.
    expect(reasons.some((l) => l.includes('0 of 4'))).toBe(false);
  });

  it('surfaces a dominant problem with a minus sign', () => {
    const lines = citizenInspectData(
      detail({
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
      }),
    ).lines;
    const reasons = lines.filter((l) => l.startsWith('  '));
    expect(reasons[0]).toBe('  −22 Home at (12, 40) has no power');
    expect(reasons.every((l) => l.startsWith('  −'))).toBe(true);
  });

  it('handles the unemployed without inventing a workplace or commute', () => {
    const lines = citizenInspectData(detail({ work: null, commuteCells: null })).lines;
    expect(lines).toContain('Works nowhere — no job yet');
    expect(lines.some((l) => l.startsWith('Commute:'))).toBe(false);
  });

  it('flags a household whose home is gone', () => {
    const data = citizenInspectData(detail({ home: null }));
    expect(data.title).toBe('Household with no home');
    expect(data.abandoned).toBe(true);
    expect(data.lines.some((l) => l.includes('their home is gone'))).toBe(true);
  });

  it('marks a household living in an abandoned building', () => {
    const data = citizenInspectData(detail({ home: place({ abandoned: true }) }));
    expect(data.abandoned).toBe(true);
    expect(data.lines.some((l) => l.includes('abandoned'))).toBe(true);
  });

  it('omits the destination line when they are not going anywhere', () => {
    const lines = citizenInspectData(detail({ destination: null, agent: null })).lines;
    expect(lines.some((l) => l.startsWith('Heading to'))).toBe(false);
    expect(lines).not.toContain('Currently walking');
  });
});
