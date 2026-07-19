import { DEFAULT_LAND_VALUE } from './zoning';

/** Field values (pollution, noise, land value) are clamped to [0, FIELD_MAX]. */
export const FIELD_MAX = 100;
/**
 * Decayed values below this are cleared back to the layer default so sparse
 * layers (and their persisted mirrors) don't accumulate float dust forever.
 */
export const FIELD_DECAY_MIN = 0.5;

export const POLLUTION_BLOCK_SIZE = 2;
export const POLLUTION_INTERVAL = 8;
export const POLLUTION_INTERVAL_OFFSET = 0;
/** Multiplicative decay applied at every pollution recompute. */
export const POLLUTION_DECAY = 0.88;
/** Added per level at a non-abandoned industrial building's anchor block. */
export const POLLUTION_PER_INDUSTRIAL_LEVEL = 6;
/** Radial linear falloff radius (Euclidean, in blocks) for industrial emissions. */
export const POLLUTION_FALLOFF_RADIUS_BLOCKS = 3;

export const NOISE_BLOCK_SIZE = 2;
export const NOISE_INTERVAL = 8;
export const NOISE_INTERVAL_OFFSET = 6;
/** Multiplicative decay applied at every noise recompute. */
export const NOISE_DECAY = 0.85;
/** Every road cell emits NOISE_ROAD_BASE + NOISE_PER_CONGESTION_BUCKET x bucket. */
export const NOISE_ROAD_BASE = 1;
export const NOISE_PER_CONGESTION_BUCKET = 2;
/** Added per level at a non-abandoned commercial building's anchor block. */
export const NOISE_PER_COMMERCIAL_LEVEL = 4;

export const LAND_VALUE_BLOCK_SIZE = 4;
export const LAND_VALUE_INTERVAL = 16;
export const LAND_VALUE_INTERVAL_OFFSET = 12;
/** Baseline value; also the layer default so unwritten blocks read neutral. */
export const LAND_VALUE_BASE = DEFAULT_LAND_VALUE;
export const LAND_VALUE_WATER_BONUS = 15;
/** Water within this Chebyshev distance (cells) of a block grants the bonus. */
export const LAND_VALUE_WATER_RADIUS = 6;
/** Per covering service, counted over SERVICE_TYPES (fire, police, health, education, parks). */
export const LAND_VALUE_COVERAGE_WEIGHT = 8;
export const LAND_VALUE_TREE_BONUS = 4;
/** Live trees within this Chebyshev distance (cells) of a block grant the bonus. */
export const LAND_VALUE_TREE_RADIUS = 3;
export const LAND_VALUE_POLLUTION_WEIGHT = 0.4;
export const LAND_VALUE_NOISE_WEIGHT = 0.25;
