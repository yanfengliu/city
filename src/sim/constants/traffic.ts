export const MAX_VEHICLES = 600;
/** Bounded visible household-member walkers; independent of vehicle capacity. */
export const MAX_PEDESTRIANS = 256;

/**
 * Share of the walker pool the member pass (school runs) may occupy.
 *
 * The member pass runs before the household pass every trip run, so without a
 * reservation it wins the race for the shared pool systematically rather than
 * occasionally. Measured on a 494-household grid town where every home is
 * school-covered: school walkers alone reached all 256 slots and the pool sat
 * full for 8% of morning ticks, during which no commute or errand could start
 * at all. Rosters average about one school-age member per household, so any
 * large city hits this every single morning.
 *
 * Reserving a quarter of the pool for household legs keeps a rush hour visibly
 * mixed — children AND commuters — instead of a morning that is all children.
 * Bounded either way: whatever cannot start simply retries.
 */
export const MEMBER_WALKER_SHARE = 0.75;
export const MAX_MEMBER_WALKERS = Math.floor(MAX_PEDESTRIANS * MEMBER_WALKER_SHARE);

export const TRIP_INTERVAL = 8;
export const TRIP_INTERVAL_OFFSET = 2;
/** Trip-start candidates considered per system run. */
export const TRIPS_PER_RUN = 24;

export const EMPLOYMENT_INTERVAL = 8;
export const EMPLOYMENT_INTERVAL_OFFSET = 4;
export const EMPLOYMENT_ASSIGNMENTS_PER_RUN = 32;

/** Cells per tick on an empty road (≈50 km/h at 8 m cells, 20 TPS). */
export const VEHICLE_BASE_SPEED = 0.35;
/** Gameplay-compressed walking speed in road cells per tick. */
export const PEDESTRIAN_BASE_SPEED = 0.08;
/** Work routes at or below this many road cells walk instead of spawning a car. */
export const PEDESTRIAN_WORK_MAX_CELLS = 24;
/** Speed multiplier lost per congestion bucket, floored at MIN_SPEED_FACTOR. */
export const CONGESTION_SLOWDOWN_PER_BUCKET = 0.25;
export const MIN_SPEED_FACTOR = 0.25;

// Micro traffic rules (docs/design/simulation-realism.md, phase T1).
/** Minimum same-lane gap between cars: a car length plus margin, in cells. */
export const VEHICLE_HEADWAY_CELLS = 0.6;
/** Cars hold this far before a red junction node (the stop line), in cells. */
export const VEHICLE_STOP_LINE_CELLS = 0.5;
/** Same-lane walkers keep at least this personal-space gap, in cells. */
export const PEDESTRIAN_MIN_GAP_CELLS = 0.25;
/** Junctions with at least this many incident edges run a signal cycle. */
export const SIGNAL_MIN_APPROACHES = 3;
/** A car blocked from its next lane holds just short of the edge boundary. */
export const VEHICLE_EDGE_HOLD_T = 0.999;

/** Tuned so a busy artery in a ~100-citizen town reaches bucket 1-2 (playtest 2026-07-01). */
export const EDGE_CAPACITY_PER_CELL = 2;
/** Congestion (count/capacity) thresholds for buckets 1, 2, 3. */
export const BUCKET_THRESHOLDS = [0.4, 0.75, 1.0] as const;
export const CONGESTION_INTERVAL = 64;
export const CONGESTION_INTERVAL_OFFSET = 12;
/** Path cost = length x (1 + factor x bucket). */
export const EDGE_COST_BUCKET_FACTOR = 0.5;

export const SHOP_WAIT_BASE = 48;
export const SHOP_WAIT_VARIANCE = 32;
export const TRIP_RETRY_TICKS = 128;

export const PATH_MAX_ITERATIONS = 20000;
