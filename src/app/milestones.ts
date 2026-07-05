/**
 * Player-facing city rank by display population — progression flavour only, no
 * sim effect. Crossing a threshold upward fires a one-off celebration banner;
 * the current title rides along in the HUD next to the population count.
 */
export const CITY_TITLES: readonly { pop: number; title: string }[] = [
  { pop: 0, title: 'Settlement' },
  { pop: 150, title: 'Hamlet' },
  { pop: 500, title: 'Village' },
  { pop: 1500, title: 'Town' },
  { pop: 4000, title: 'City' },
  { pop: 9000, title: 'Metropolis' },
];

/** Highest rank (index into CITY_TITLES) whose threshold the population meets. */
export function cityRank(pop: number): number {
  let rank = 0;
  for (let i = 1; i < CITY_TITLES.length; i++) {
    if (pop >= CITY_TITLES[i].pop) rank = i;
  }
  return rank;
}
