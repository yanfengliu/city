/**
 * Rendering-only constants (colors, y-offsets, capacities) plus the
 * deterministic per-cell jitter hash. Gameplay values live in
 * src/sim/constants/ — nothing here may affect sim behavior.
 */

// Vertical layering (world y). Per-layer values are offsets above the shared
// terrain surface; water remains one absolute recessed plane.
export const WATER_SURFACE_Y = -0.12;
/** Highest renderer-only land relief; kept near the nominal level-one wall scale. */
export const TERRAIN_MAX_RELIEF = 0.9;
/** Normalized elevation at which relief reaches TERRAIN_MAX_RELIEF. */
export const TERRAIN_RELIEF_CEILING = 0.85;
export const ZONE_SURFACE_Y = 0.015;
export const ZONE_GROUND_DETAIL_Y = 0.017;
export const ROAD_SURFACE_Y = 0.02;
export const GHOST_SURFACE_Y = 0.03;
export const GHOST_HEIGHT = 0.1;

/** Zone kind used across rendering (plain literal type; mirrors protocol ZoneType). */
export type ZoneKind = 'R' | 'C' | 'I';

// Friendly terrain palette: bright enough to read as an inviting model table,
// while retaining enough saturation for roads, zones, and buildings to stand out.
export const LAND_COLOR = 0xa3bf72;
export const LAND_LIGHTNESS_JITTER = 0.075;
/** Gentle height tint so uplands remain legible at strategy zoom. */
export const LAND_ELEVATION_LIGHTNESS_RANGE = 0.045;
/** Water color is semantic bathymetry: pale cyan at the bank, clear blue, then deep blue. */
export const WATER_SHALLOW_COLOR = 0x69c8c5;
export const WATER_MID_COLOR = 0x49a6d7;
export const WATER_DEEP_COLOR = 0x3d8dc5;
/** Backward-compatible representative water swatch used by broad palette contracts. */
export const WATER_COLOR = WATER_MID_COLOR;
/** Elevation drop below sea level that reaches the deepest presentation color. */
export const WATER_DEEP_ELEVATION_DELTA = 0.18;
/** Position of the middle palette stop in normalized presentation depth. */
export const WATER_MID_DEPTH = 1 / 3;
/** Prevailing renderer-only wind direction across the map (normalized by the material). */
export const WATER_WIND_DIRECTION = { x: 0.82, z: 0.57 } as const;
/** Long, gentle wind swell: amplitude is in world-space render units. */
export const WATER_WAVE_PRIMARY = {
  amplitude: 0.026,
  waveNumber: 0.62,
  angularSpeed: 1.05,
} as const;
/** Smaller angled ripples keep the surface organic without becoming noisy. */
export const WATER_WAVE_SECONDARY = {
  amplitude: 0.012,
  waveNumber: 1.18,
  angularSpeed: 1.62,
  crosswindMix: 0.62,
  phase: 1.7,
} as const;
/** Amplifies virtual surface slope for visible glints without moving any geometry. */
export const WATER_WAVE_NORMAL_STRENGTH = 4;
/** Both angular speeds close exactly after 35 primary / 54 secondary cycles. */
export const WATER_WAVE_TIME_CYCLE_SECONDS =
  (Math.PI * 2 * 35) / WATER_WAVE_PRIMARY.angularSpeed;
export const SHORE_COLOR = 0xd1bc80;
export const SHORE_DETAIL_COLOR = 0xe4d39b;
export const SHORE_DETAIL_LIGHTNESS_JITTER = 0.065;
export const SHORE_DETAIL_INSET = 0.22;
export const SHORE_DETAIL_Y = 0.011;

// Roads.
export const ROAD_COLOR = 0x333a40;
export const ROAD_DETAIL_COLOR = 0x464f55;
export const ROAD_DETAIL_LIGHTNESS_JITTER = 0.055;
export const ROAD_DETAIL_Y = 0.021;
export const ROAD_DETAIL_SIDE_INSET = 0.14;
export const ROAD_DETAIL_END_INSET = 0.22;
export const ROAD_LANE_MARKING_COLOR = 0xd8e4e8;
export const ROAD_LANE_MARKING_Y = 0.0235;
export const ROAD_LANE_MARKING_WIDTH = 0.055;
export const ROAD_LANE_MARKING_LENGTH = 0.42;

// Bridges (road cells over water): concrete causeway deck + railings + pylons.
export const BRIDGE_COLOR = 0xb8ad91;
export const BRIDGE_RAIL_HEIGHT = 0.14;
export const BRIDGE_RAIL_THICKNESS = 0.08;
/** Pylon half-width (pylon box is centered in the cell). */
export const BRIDGE_PYLON_HALF_WIDTH = 0.14;
/** Pylon bottom — below the water surface so pylons read as planted. */
export const BRIDGE_PYLON_BOTTOM_Y = -0.4;

// Highway (the fixed outside connection): near-black asphalt darker than city
// roads, a dashed amber center line, and a wider ramp that fans out beyond the
// map edge so it reads as arriving from outside. Static — built once.
export const HIGHWAY_COLOR = 0x26282d;
export const HIGHWAY_LINE_COLOR = 0xe6bf3f;
/** Just above ROAD_SURFACE_Y so the highway wins at the road seam. */
export const HIGHWAY_SURFACE_Y = 0.022;
/** Center line sits above the asphalt; polygonOffset (below) hardens the seam at far zoom. */
export const HIGHWAY_LINE_Y = 0.03;
/** Cells the ramp extends past the edge (decorative; off the buildable grid). */
export const HIGHWAY_OFFMAP_CELLS = 6;
/** Half-width (cells) of the ramp mouth at its far, off-map end. */
export const HIGHWAY_RAMP_HALF_WIDTH = 1.6;
export const HIGHWAY_LINE_WIDTH = 0.09;
export const HIGHWAY_DASH_LENGTH = 0.55;
export const HIGHWAY_DASH_GAP = 0.55;

// Trees. Archetypes vary geometry while palettes vary as coordinated
// trunk/lower/upper families, all assigned from deterministic cell hashes.
export type TreeArchetypeName = 'conifer' | 'broadleaf' | 'columnar';
export type TreeCanopyShape = 'cone' | 'faceted';

export interface TreeCanopyLayerSpec {
  shape: TreeCanopyShape;
  radius: number;
  height: number;
  lift: number;
}

export interface TreeArchetypeSpec {
  name: TreeArchetypeName;
  trunkHeight: number;
  trunkRadius: number;
  lower: TreeCanopyLayerSpec;
  upper: TreeCanopyLayerSpec;
}

export const TREE_ARCHETYPES: readonly TreeArchetypeSpec[] = [
  {
    name: 'conifer',
    trunkHeight: 0.34,
    trunkRadius: 0.055,
    lower: { shape: 'cone', radius: 0.39, height: 0.84, lift: 0 },
    upper: { shape: 'cone', radius: 0.3, height: 0.7, lift: 0.5 },
  },
  {
    name: 'broadleaf',
    trunkHeight: 0.48,
    trunkRadius: 0.075,
    lower: { shape: 'faceted', radius: 0.385, height: 0.62, lift: 0.08 },
    upper: { shape: 'faceted', radius: 0.34, height: 0.48, lift: 0.48 },
  },
  {
    name: 'columnar',
    trunkHeight: 0.5,
    trunkRadius: 0.06,
    lower: { shape: 'faceted', radius: 0.24, height: 1.1, lift: 0.04 },
    upper: { shape: 'faceted', radius: 0.19, height: 0.78, lift: 0.67 },
  },
] as const;

export const TREE_FOLIAGE_PALETTES = [
  { trunk: 0x765034, lower: 0x4f8c45, upper: 0x72aa5c },
  { trunk: 0x84573b, lower: 0x5da64d, upper: 0x8acb69 },
  { trunk: 0x6f5237, lower: 0x789348, upper: 0xa9b965 },
  { trunk: 0x69513c, lower: 0x407f69, upper: 0x64a98a },
] as const;

/** Backward-compatible primary colors used by the general landscape contract. */
export const TREE_TRUNK_COLOR = TREE_FOLIAGE_PALETTES[0].trunk;
export const TREE_CANOPY_COLOR = TREE_FOLIAGE_PALETTES[0].lower;
export const TREE_CANOPY_HIGHLIGHT_COLOR = TREE_FOLIAGE_PALETTES[0].upper;
export const TREE_CANOPY_EMISSIVE_COLOR = 0x2f4934;
export const TREE_CANOPY_EMISSIVE_INTENSITY = 0.08;
export const TREE_CANOPY_HUE_JITTER = 0.012;
export const TREE_CANOPY_LIGHT_JITTER = 0.035;
export const TREE_SCALE_MIN = 0.82;
export const TREE_SCALE_RANGE = 0.3;
export const TREE_WIDTH_SCALE_MIN = 0.92;
export const TREE_WIDTH_SCALE_RANGE = 0.13;
export const TREE_HEIGHT_SCALE_MIN = 0.88;
export const TREE_HEIGHT_SCALE_RANGE = 0.3;
export const TREE_POSITION_JITTER = 0.04;

// Zone tint overlay (translucent quads over zoned-but-empty cells).
export const ZONE_TINT_OPACITY = 0.45;
export const ZONE_GROUND_DETAIL_OPACITY = 0.16;
export const ZONE_GROUND_DETAIL_INSET = 0.28;
export const ZONE_COLORS: Record<ZoneKind, number> = {
  R: 0x59b861,
  C: 0x5598d4,
  I: 0xe1a34c,
};
export const ZONE_GROUND_DETAIL_COLORS: Record<ZoneKind, number> = {
  R: 0x8ddc94,
  C: 0x83bfe8,
  I: 0xf0c274,
};

// Buildings (instanced box + roof per zone archetype).
export const BUILDING_START_CAPACITY = 512;
/** Footprint fill fraction — leaves a small setback so neighbors read as separate buildings. */
export const BUILDING_FOOTPRINT_MARGIN = 0.9;
/** Wall height by level (index level-1), in world units. */
export const BUILDING_LEVEL_HEIGHTS: [number, number, number] = [0.9, 1.6, 2.6];
/** Multiplicative height jitter range (1 ± JITTER/2), hashed from the building id. */
export const BUILDING_HEIGHT_JITTER = 0.16;
/** Per-building footprint shrink (each axis independently) so silhouettes vary
 * — subtracted from the margin, keeping every building inside its cell. */
export const BUILDING_FOOTPRINT_JITTER = 0.12;
/** Roofs slightly overhang walls so districts read as tiled/wood rooflines
 * instead of plain extruded blocks. Clamped per footprint in the renderer. */
export const BUILDING_ROOF_OVERHANG = 0.18;
/** Subtle per-building tint jitter (keeps the zone colour readable, breaks up
 * the row-of-clones look). */
export const BUILDING_TINT_HUE_JITTER = 0.03;
export const BUILDING_TINT_LIGHT_JITTER = 0.08;
export const BUILDING_ROOF_HEIGHTS: Record<ZoneKind, number> = { R: 0.5, C: 0.16, I: 0.24 };
/** Zone-specific rooftop profiles: chimney, service core, and broad low HVAC. */
export const BUILDING_DETAIL_HEIGHTS: Record<ZoneKind, number> = { R: 0.42, C: 0.62, I: 0.18 };
export const BUILDING_DETAIL_WIDTHS: Record<ZoneKind, number> = { R: 0.16, C: 0.26, I: 0.48 };
export const BUILDING_DETAIL_COLORS: Record<ZoneKind, number> = {
  R: 0x78a96f,
  C: 0x6e9fc5,
  I: 0xb98a52,
};
export const BUILDING_ABANDONED_DETAIL_COLOR = 0x7a7f7c;
/** Window positions use normalized wall space and are instanced with each building body. */
export interface BuildingWindowLayout {
  frontColumns: readonly number[];
  sideColumns: readonly number[];
  rows: readonly number[];
  width: number;
  height: number;
}

export const BUILDING_WINDOW_LAYOUTS: Record<ZoneKind, BuildingWindowLayout> = {
  R: { frontColumns: [-0.24, 0.24], sideColumns: [0], rows: [0.4, 0.7], width: 0.18, height: 0.16 },
  C: {
    frontColumns: [-0.28, 0.28],
    sideColumns: [-0.24, 0.24],
    rows: [0.3, 0.56, 0.82],
    width: 0.22,
    height: 0.13,
  },
  I: { frontColumns: [-0.28, 0.28], sideColumns: [0], rows: [0.8], width: 0.2, height: 0.13 },
};
/** Small outward offset prevents coplanar wall/window flicker. */
export const BUILDING_WINDOW_SURFACE_OFFSET = 0.008;

export type BuildingFrontageKind =
  | 'front-door'
  | 'stoop'
  | 'porch-canopy'
  | 'double-entry'
  | 'awning'
  | 'sign-band'
  | 'blade-sign'
  | 'loading-bay'
  | 'personnel-door'
  | 'loading-dock'
  | 'loading-hood'
  | 'bollard-left'
  | 'bollard-right';

export interface BuildingFrontagePart {
  kind: BuildingFrontageKind;
  /** Normalized width, height, and outward depth. */
  size: readonly [number, number, number];
  /** Normalized horizontal center and bottom edge. */
  x: number;
  baseY: number;
}

export const BUILDING_FRONTAGE_PARTS: Record<ZoneKind, readonly BuildingFrontagePart[]> = {
  R: [
    { kind: 'front-door', size: [0.22, 0.5, 0.045], x: 0, baseY: 0 },
    { kind: 'stoop', size: [0.4, 0.06, 0.28], x: 0, baseY: 0 },
    { kind: 'porch-canopy', size: [0.42, 0.06, 0.24], x: 0, baseY: 0.56 },
  ],
  C: [
    { kind: 'double-entry', size: [0.3, 0.56, 0.045], x: 0, baseY: 0 },
    { kind: 'awning', size: [0.8, 0.08, 0.26], x: 0, baseY: 0.58 },
    { kind: 'sign-band', size: [0.84, 0.14, 0.05], x: 0, baseY: 0.7 },
    { kind: 'blade-sign', size: [0.12, 0.3, 0.2], x: -0.4, baseY: 0.66 },
  ],
  I: [
    { kind: 'loading-bay', size: [0.58, 0.56, 0.05], x: 0.1, baseY: 0 },
    { kind: 'personnel-door', size: [0.16, 0.42, 0.045], x: -0.34, baseY: 0 },
    { kind: 'loading-dock', size: [0.72, 0.1, 0.3], x: 0.08, baseY: 0 },
    { kind: 'loading-hood', size: [0.68, 0.08, 0.22], x: 0.08, baseY: 0.62 },
    { kind: 'bollard-left', size: [0.05, 0.28, 0.05], x: -0.24, baseY: 0 },
    { kind: 'bollard-right', size: [0.05, 0.28, 0.05], x: 0.4, baseY: 0 },
  ],
};
export const BUILDING_FRONTAGE_SURFACE_OFFSET = 0.008;
/** Entrances stay ground-floor sized when the body grows into a higher-level building. */
export const BUILDING_FRONTAGE_HEIGHT_MAX = 1.1;
export const BUILDING_WALL_COLORS: Record<ZoneKind, number> = {
  R: 0xa4c995,
  C: 0x78add6,
  I: 0xd5aa6f,
};
export const BUILDING_ROOF_COLORS: Record<ZoneKind, number> = {
  R: 0x5d9362,
  C: 0x4a78ad,
  I: 0xa77443,
};
export const BUILDING_WINDOW_COLORS: Record<ZoneKind, number> = {
  R: 0x8eb8d1,
  C: 0x79d4e8,
  I: 0x6c7d7f,
};
export const BUILDING_FRONTAGE_COLORS: Record<ZoneKind, number> = {
  R: 0x7a3f2a,
  C: 0x245b88,
  I: 0x242a2c,
};
/** Per-level lightness boost so level differences read beyond height alone. */
export const BUILDING_LEVEL_WALL_LIGHTEN = 0.02;
export const BUILDING_LEVEL_ROOF_LIGHTEN = 0.04;
export const BUILDING_ABANDONED_WALL_COLOR = 0x8b918e;
export const BUILDING_ABANDONED_ROOF_COLOR = 0x6f7472;
export const BUILDING_ABANDONED_FRONTAGE_COLOR = 0x555a58;
/** Warm emissive hue for live window panels only. */
export const BUILDING_NIGHT_GLOW_COLOR = 0xffca7a;
/** Windows stay dark through daylight; intensity normalizes from START to full night. */
export const BUILDING_WINDOW_GLOW_START = 0.75;
export const BUILDING_WINDOW_GLOW_MAX = 0.55;

// Ghost drag preview. Capacity covers the longest L-path on a 128x128 grid (255
// cells) and rect drags up to 1024 cells; larger rect previews clip (the command
// itself is unaffected).
export const GHOST_CAPACITY = 1024;
export const GHOST_OPACITY = 0.45;
export const GHOST_VALID_COLOR = 0xffffff;
export const GHOST_INVALID_COLOR = 0xd94040;

// Vehicles (instanced low-poly cars; sim caps concurrent vehicles at 600).
export const VEHICLE_CAPACITY = 600;
export const VEHICLE_Y = 0.12;
export const VEHICLE_BODY_LENGTH = 0.5;
export const VEHICLE_BODY_HEIGHT = 0.25;
export const VEHICLE_BODY_WIDTH = 0.3;
export const VEHICLE_ROOF_LENGTH = 0.26;
export const VEHICLE_ROOF_HEIGHT = 0.1;
export const VEHICLE_ROOF_WIDTH = 0.24;
/** Instance tint by the vehicle's edge congestion bucket (speed proxy): white → orange → red. */
export const VEHICLE_BUCKET_COLORS: readonly [number, number, number, number] = [
  0xffffff, 0xffd27d, 0xff8c3a, 0xe0453a,
];
/** Renderer-side lerp window between vehicle messages (one sim tick ≈ 50 ms at 1x). */
export const VEHICLE_LERP_DEFAULT_MS = 50;
export const VEHICLE_LERP_MIN_MS = 15;
export const VEHICLE_LERP_MAX_MS = 250;

// Pedestrians (three instanced clothing layers sharing one transform buffer).
export const PEDESTRIAN_CAPACITY = 256;
export const PEDESTRIAN_CURB_OFFSET = 0.3;
export const PEDESTRIAN_BODY = { width: 0.12, height: 0.2, depth: 0.07, y: 0.26 } as const;
export const PEDESTRIAN_LEG = {
  width: 0.035, height: 0.16, depth: 0.04, x: 0.032, y: 0.08, stride: 0.025,
} as const;
export const PEDESTRIAN_HEAD = { radius: 0.065, y: 0.43 } as const;

// Traffic overlay (road cells tinted by their edge's congestion bucket).
export const TRAFFIC_OVERLAY_Y = 0.028;
export const TRAFFIC_BUCKET_COLORS: readonly [number, number, number, number] = [
  0x69a869, 0xe3cf4a, 0xf2953b, 0xe0453a,
];

// Field overlays (translucent DataTexture plane over the terrain).
export const FIELD_OVERLAY_Y = 0.05;
export const FIELD_OVERLAY_OPACITY = 0.45;
/** Field values are clamped to [0, FIELD_OVERLAY_VALUE_MAX] by the sim. */
export const FIELD_OVERLAY_VALUE_MAX = 100;
/** Field kind used across rendering (plain literal type; mirrors protocol FieldName). */
export type FieldKind = 'pollution' | 'noise' | 'landValue';
/** Two-stop color ramps, lerped by value/FIELD_OVERLAY_VALUE_MAX. */
export const FIELD_RAMPS: Record<FieldKind, { low: number; high: number }> = {
  pollution: { low: 0x46a34a, high: 0x5f4726 },
  noise: { low: 0x46a34a, high: 0x7a3fae },
  landValue: { low: 0xd9483f, high: 0x3fae4a },
};

// Service structures (player-placed 2x2 buildings; taller than level-1 RCI so they read).
/** Service kind used across rendering (plain literal type; mirrors protocol ServiceType). */
export type ServiceKind = 'fireStation' | 'police' | 'clinic' | 'school';
export const STRUCTURE_START_CAPACITY = 64;
export const STRUCTURE_FOOTPRINT_MARGIN = 0.9;
export const STRUCTURE_WALL_HEIGHT = 1.2;
export const STRUCTURE_ROOF_HEIGHT = 0.22;
export const STRUCTURE_DETAIL_HEIGHT = 0.36;
export const STRUCTURE_DETAIL_LENGTH = 0.86;
export const STRUCTURE_DETAIL_WIDTH = 0.34;
export const STRUCTURE_WALL_COLORS: Record<ServiceKind, number> = {
  fireStation: 0xe36152,
  police: 0x5f7fbd,
  clinic: 0xf8f5ea,
  school: 0xe5bc55,
};
export const STRUCTURE_ROOF_COLORS: Record<ServiceKind, number> = {
  fireStation: 0xfff8ed,
  police: 0xc1d4eb,
  clinic: 0xe36152,
  school: 0xa87549,
};
export const STRUCTURE_DETAIL_COLORS: Record<ServiceKind, number> = {
  fireStation: 0xa93630,
  police: 0xf8f5ea,
  clinic: 0xa94343,
  school: 0x765337,
};

/** Day/night endpoints consumed by CityScene. Kept as raw hex constants so
 * the palette contract can be tested without constructing a WebGL renderer. */
export const ATMOSPHERE_COLORS = {
  skyTopDay: 0x65a7e5,
  skyTopNight: 0x3d5f8a,
  skyHorizonDay: 0xd5edf8,
  skyHorizonNight: 0x819db8,
  hemiSkyDay: 0xd6ebf7,
  hemiSkyNight: 0x9fb4c7,
  hemiGroundDay: 0x899b62,
  hemiGroundNight: 0x75885c,
  sunDay: 0xfff8e9,
  sunLow: 0xffbd73,
} as const;

/** Lighting endpoints paired with ATMOSPHERE_COLORS. The elevated dusk/night
 * floors are intentional: the game should dim into a friendly blue dusk, not
 * hide the city in near-black lighting. */
export const ATMOSPHERE_LIGHT_INTENSITY = {
  sunBase: 1.15,
  sunDaylightBoost: 1.85,
  hemisphereBase: 1.05,
  hemisphereNightBoost: 0.55,
} as const;

/** Deterministic integer hash of a cell index → [0, 1). Drives per-cell visual jitter. */
export function cellHash01(index: number): number {
  let h = (index + 1) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Utility network visuals (phase 5)
export const PLANT_COLOR = 0x7c858e;
export const POLE_COLOR = 0x9d835d;
export const PUMP_COLOR = 0x5b98d2;
export const PIPE_COLOR = 0x2e4a5f;
/** Pipes are underground; expose this near-ground hint only in the Water overlay. */
export const PIPE_Y = 0.006;
/** Overhead cable strung between poles (near-black), just below the pole cap. */
export const WIRE_COLOR = 0x232323;
export const WIRE_Y = 0.82;
/**
 * A power line is a thin overhead cable — poles support it only at its ends,
 * corners, and junctions, plus one every POLE_SPACING cells along a straight
 * run, so a long line spans far without a pole on every cell.
 */
export const POLE_SPACING = 6;

// Utility-problem icon (floating ⚡/💧 above a live building missing a utility).
export const UTILITY_ICON_SCALE = 0.38;
/** Vertical bob amplitude (units) so the icon reads as an alert, not decor. */
export const UTILITY_ICON_BOUNCE = 0.08;
/** Gap above the building's roof top where the icon floats. */
export const UTILITY_ICON_Y_GAP = 0.34;
export const UTILITY_ICON_POWER_BADGE_COLOR = 0xd9a62e;
export const UTILITY_ICON_WATER_BADGE_COLOR = 0x4aa3d8;
export const UTILITY_ICON_BADGE_STROKE_COLOR = 0x2f2a24;

// Level-up celebration (floating "▲ Level N" sprite above the building).
export const LEVELUP_DURATION_MS = 1600;
export const LEVELUP_RISE_UNITS = 1.6;
export const LEVELUP_SPRITE_SCALE = 0.9;
export const LEVELUP_START_Y = 1.4;

// Effect-radius placement preview
export const RADIUS_FILL_COLOR = 0x53c1e8;
export const RADIUS_FILL_OPACITY = 0.1;
export const RADIUS_LINE_COLOR = 0x8fe0ff;
export const RADIUS_Y = 0.03;

/** Utility (power/water) overlay plane height — above field overlays. */
export const NETWORK_OVERLAY_Y = 0.055;
