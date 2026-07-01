/** Elevation below this (normalized [0,1]) is water. */
export const WATER_THRESHOLD = 0.35;
/** Tree-noise above this (normalized [0,1]) places a decorative tree on land. */
export const TREE_THRESHOLD = 0.62;
export const ELEVATION_NOISE_SCALE = 0.045;
export const ELEVATION_OCTAVES = 4;
export const TREE_NOISE_SCALE = 0.15;
/** Smallest acceptable largest-water-body size; smaller maps re-roll the seed offset. */
export const MIN_WATER_BODY_CELLS = 60;
export const MAX_TERRAIN_ATTEMPTS = 20;
/** Seed offset step between terrain generation attempts. */
export const TERRAIN_ATTEMPT_SEED_STEP = 1000;
