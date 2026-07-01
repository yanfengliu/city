/**
 * Rendering-only constants (colors, y-offsets, capacities) plus the
 * deterministic per-cell jitter hash. Gameplay values live in
 * src/sim/constants/ — nothing here may affect sim behavior.
 */

// Vertical layering (world y). Terrain land sits at y=0.
export const WATER_SURFACE_Y = -0.12;
export const ZONE_SURFACE_Y = 0.015;
export const ROAD_SURFACE_Y = 0.02;
export const GHOST_SURFACE_Y = 0.03;
export const GHOST_HEIGHT = 0.1;

/** Zone kind used across rendering (plain literal type; mirrors protocol ZoneType). */
export type ZoneKind = 'R' | 'C' | 'I';

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

// Zone tint overlay (translucent quads over zoned-but-empty cells).
export const ZONE_TINT_OPACITY = 0.45;
export const ZONE_COLORS: Record<ZoneKind, number> = {
  R: 0x46a34a,
  C: 0x3f74c9,
  I: 0xcf8a2d,
};

// Buildings (instanced box + roof per zone archetype).
export const BUILDING_START_CAPACITY = 512;
/** Footprint fill fraction — leaves a small setback so neighbors read as separate buildings. */
export const BUILDING_FOOTPRINT_MARGIN = 0.9;
/** Wall height by level (index level-1), in world units. */
export const BUILDING_LEVEL_HEIGHTS: [number, number, number] = [0.9, 1.6, 2.6];
/** Multiplicative height jitter range (1 ± JITTER/2), hashed from the building id. */
export const BUILDING_HEIGHT_JITTER = 0.16;
export const BUILDING_ROOF_HEIGHTS: Record<ZoneKind, number> = { R: 0.35, C: 0.1, I: 0.18 };
export const BUILDING_WALL_COLORS: Record<ZoneKind, number> = {
  R: 0xd9cbaa,
  C: 0xa7bdd6,
  I: 0xb5a48c,
};
export const BUILDING_ROOF_COLORS: Record<ZoneKind, number> = {
  R: 0xa8563e,
  C: 0x3d6b9e,
  I: 0xb87b33,
};
/** Per-level lightness boost so level differences read beyond height alone. */
export const BUILDING_LEVEL_WALL_LIGHTEN = 0.03;
export const BUILDING_LEVEL_ROOF_LIGHTEN = 0.07;
export const BUILDING_ABANDONED_WALL_COLOR = 0x6f6f6f;
export const BUILDING_ABANDONED_ROOF_COLOR = 0x585858;

// Ghost drag preview. Capacity covers the longest L-path on a 128x128 grid (255
// cells) and rect drags up to 1024 cells; larger rect previews clip (the command
// itself is unaffected).
export const GHOST_CAPACITY = 1024;
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
