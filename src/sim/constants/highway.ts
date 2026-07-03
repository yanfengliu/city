import { GRID_WIDTH } from './map';

/**
 * The city's fixed link to the outside world: a straight highway stub that
 * enters from the north (top, y=0) edge at the horizontal center and runs
 * HIGHWAY_LENGTH cells inward. It is seeded as real road cells so the player's
 * network connects to it (the gateway/anchor), but it is protected from
 * bulldoze — you cannot sever the connection to the outside.
 *
 * Placement is deterministic (pure function of the grid width); `createCitySim`
 * clears water/trees under it so it always lands on solid ground.
 */
export const HIGHWAY_LENGTH = 10;
export const HIGHWAY_COLUMN = Math.floor(GRID_WIDTH / 2);

/** Highway cell indices, edge cell (y=0) first. */
export const HIGHWAY_CELLS: readonly number[] = Array.from(
  { length: HIGHWAY_LENGTH },
  (_, y) => y * GRID_WIDTH + HIGHWAY_COLUMN,
);

/** Membership test for seeding, bulldoze protection, and distinct rendering. */
export const HIGHWAY_CELL_SET: ReadonlySet<number> = new Set(HIGHWAY_CELLS);
