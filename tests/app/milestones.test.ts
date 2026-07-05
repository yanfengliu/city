import { describe, expect, it } from 'vitest';
import { CITY_TITLES, cityRank } from '../../src/app/milestones';

describe('city rank', () => {
  it('maps population to the highest met threshold', () => {
    expect(CITY_TITLES[cityRank(0)].title).toBe('Settlement');
    expect(CITY_TITLES[cityRank(149)].title).toBe('Settlement');
    expect(CITY_TITLES[cityRank(150)].title).toBe('Hamlet');
    expect(CITY_TITLES[cityRank(499)].title).toBe('Hamlet');
    expect(CITY_TITLES[cityRank(500)].title).toBe('Village');
    expect(CITY_TITLES[cityRank(1500)].title).toBe('Town');
    expect(CITY_TITLES[cityRank(4000)].title).toBe('City');
    expect(CITY_TITLES[cityRank(50_000)].title).toBe('Metropolis');
  });

  it('never decreases as population grows', () => {
    let prev = -1;
    for (let pop = 0; pop <= 12_000; pop += 137) {
      const rank = cityRank(pop);
      expect(rank).toBeGreaterThanOrEqual(prev);
      prev = rank;
    }
  });
});
