export const MAX_VEHICLES = 600;

export const TRIP_INTERVAL = 8;
export const TRIP_INTERVAL_OFFSET = 2;
/** Trip-start candidates considered per system run. */
export const TRIPS_PER_RUN = 24;

export const EMPLOYMENT_INTERVAL = 8;
export const EMPLOYMENT_INTERVAL_OFFSET = 4;
export const EMPLOYMENT_ASSIGNMENTS_PER_RUN = 32;

/** Cells per tick on an empty road (≈50 km/h at 8 m cells, 20 TPS). */
export const VEHICLE_BASE_SPEED = 0.35;
/** Speed multiplier lost per congestion bucket, floored at MIN_SPEED_FACTOR. */
export const CONGESTION_SLOWDOWN_PER_BUCKET = 0.25;
export const MIN_SPEED_FACTOR = 0.25;

export const EDGE_CAPACITY_PER_CELL = 6;
/** Congestion (count/capacity) thresholds for buckets 1, 2, 3. */
export const BUCKET_THRESHOLDS = [0.4, 0.75, 1.0] as const;
export const CONGESTION_INTERVAL = 64;
export const CONGESTION_INTERVAL_OFFSET = 12;
/** Path cost = length x (1 + factor x bucket). */
export const EDGE_COST_BUCKET_FACTOR = 0.5;

export const WORK_WAIT_BASE = 64;
export const WORK_WAIT_VARIANCE = 64;
export const HOME_COOLDOWN_BASE = 256;
export const HOME_COOLDOWN_VARIANCE = 256;

export const PATH_MAX_ITERATIONS = 20000;
