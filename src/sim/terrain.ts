import { createNoise2D, octaveNoise2D } from 'civ-engine';
import {
  ELEVATION_NOISE_SCALE,
  ELEVATION_OCTAVES,
  MAX_TERRAIN_ATTEMPTS,
  MIN_WATER_BODY_CELLS,
  TERRAIN_ATTEMPT_SEED_STEP,
  TREE_NOISE_SCALE,
  TREE_THRESHOLD,
  WATER_THRESHOLD,
} from './constants/terrain';

export interface TerrainData {
  width: number;
  height: number;
  /** Normalized seeded elevation in [0,1], per cell index. */
  elevation: Float32Array;
  /** Normalized waterline used to interpret elevation renderer-side. */
  seaLevel: number;
  /** 1 = water, 0 = land, per cell index. */
  water: Uint8Array;
  /** 1 = decorative tree (always on land), per cell index. */
  trees: Uint8Array;
  /** Seed actually used after re-roll attempts (base seed + k * step). */
  effectiveSeed: number;
}

function generateOnce(seed: number, width: number, height: number): TerrainData {
  const elevationNoise = createNoise2D(seed);
  const treeNoise = createNoise2D(seed + 1);
  const elevation = new Float32Array(width * height);
  const water = new Uint8Array(width * height);
  const trees = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const sample =
        (octaveNoise2D(
          elevationNoise,
          x * ELEVATION_NOISE_SCALE,
          y * ELEVATION_NOISE_SCALE,
          ELEVATION_OCTAVES,
        ) +
          1) /
        2;
      elevation[i] = sample;
      if (sample < WATER_THRESHOLD) {
        water[i] = 1;
      } else if ((treeNoise(x * TREE_NOISE_SCALE, y * TREE_NOISE_SCALE) + 1) / 2 > TREE_THRESHOLD) {
        trees[i] = 1;
      }
    }
  }
  return {
    width,
    height,
    elevation,
    seaLevel: WATER_THRESHOLD,
    water,
    trees,
    effectiveSeed: seed,
  };
}

function largestWaterBody(terrain: TerrainData): number {
  const { width, height, water } = terrain;
  const seen = new Uint8Array(width * height);
  let largest = 0;
  const stack: number[] = [];
  for (let start = 0; start < water.length; start++) {
    if (water[start] !== 1 || seen[start] === 1) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      size++;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (water[ni] === 1 && seen[ni] === 0) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

/**
 * Deterministic terrain from a seed. Re-rolls with a fixed seed offset until
 * the map contains a water body of at least MIN_WATER_BODY_CELLS (so pumps and
 * water-proximity land value always have something to work with).
 */
export function generateTerrain(seed: number, width: number, height: number): TerrainData {
  let terrain = generateOnce(seed, width, height);
  for (let attempt = 1; attempt < MAX_TERRAIN_ATTEMPTS; attempt++) {
    if (largestWaterBody(terrain) >= MIN_WATER_BODY_CELLS) return terrain;
    terrain = generateOnce(seed + attempt * TERRAIN_ATTEMPT_SEED_STEP, width, height);
  }
  return terrain;
}
