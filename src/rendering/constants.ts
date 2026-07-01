/**
 * Rendering-only constants (colors, y-offsets, capacities) plus the
 * deterministic per-cell jitter hash. Gameplay values live in
 * src/sim/constants/ — nothing here may affect sim behavior.
 */

// Vertical layering (world y). Terrain land sits at y=0.
export const WATER_SURFACE_Y = -0.12;
export const ROAD_SURFACE_Y = 0.02;
export const GHOST_SURFACE_Y = 0.03;
export const GHOST_HEIGHT = 0.1;

// Terrain palette.
export const LAND_COLOR = 0x6fa557;
export const LAND_LIGHTNESS_JITTER = 0.05;
export const WATER_COLOR = 0x2f6db3;
export const SHORE_COLOR = 0x9a8a63;

// Roads.
export const ROAD_COLOR = 0x3a3d42;

// Trees.
export const TREE_TRUNK_COLOR = 0x6b4a2f;
export const TREE_CANOPY_COLOR = 0x2e7d3c;
export const TREE_TRUNK_HEIGHT = 0.35;
export const TREE_TRUNK_RADIUS = 0.06;
export const TREE_CANOPY_HEIGHT = 0.85;
export const TREE_CANOPY_RADIUS = 0.32;
export const TREE_SCALE_MIN = 0.8;
export const TREE_SCALE_RANGE = 0.5;

// Ghost drag preview. Capacity covers the longest L-path on a 128x128 grid (255 cells).
export const GHOST_CAPACITY = 256;
export const GHOST_OPACITY = 0.45;
export const GHOST_VALID_COLOR = 0xffffff;
export const GHOST_INVALID_COLOR = 0xd94040;

/** Deterministic integer hash of a cell index → [0, 1). Drives per-cell visual jitter. */
export function cellHash01(index: number): number {
  let h = (index + 1) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
