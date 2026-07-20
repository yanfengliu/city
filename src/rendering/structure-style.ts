import type { ServiceKind } from './constants';
import { UTILITY_PAD_COLOR, UTILITY_PAD_LIFT } from './utility-structure-style';

/**
 * Dimensions and palette for the detailed coverage-service models (fire
 * station, police station, clinic, school, park, garden). Rendering-only; footprints
 * and placement rules stay in src/sim/constants/services.ts. Lengths are world
 * units (1 = one grid cell); model-local heights are measured above the pad
 * top. Layout offsets inside the 2x2 footprint live with the geometry in
 * service-structures.ts as footprint fractions — except the leisure
 * landscapes, whose compositions are tabulated here.
 */

// Every service stands on the same leveled civic concrete as the utilities.
export const SERVICE_PAD_LIFT = UTILITY_PAD_LIFT;
export const SERVICE_PAD_COLOR = UTILITY_PAD_COLOR;
/** How deep pads bury below the lowest footprint corner (hidden on slopes). */
export const SERVICE_PAD_BURY = 0.25;
/** Pad inset from the footprint edge, as a fraction of the footprint. */
export const SERVICE_PAD_MARGIN = 0.03;
/** Shared asphalt for the fire apron and police parking pad. */
export const SERVICE_APRON_COLOR = 0x53565c;
/** Low-poly segment count for posts, poles, and masts. */
export const SERVICE_POST_SEGMENTS = 6;

/**
 * Signature wall hue per service — the palette identity contract keeps these
 * bright, saturated, and mutually distinct so services read against RCI.
 */
export const SERVICE_WALL_COLORS: Record<ServiceKind, number> = {
  fireStation: 0xe36152,
  police: 0x5f7fbd,
  clinic: 0xf8f5ea,
  school: 0xe5bc55,
  // The park has no walls; this is its lawn, and it plays the same identity
  // role — the one colour that says "park" from the strategy camera.
  park: 0x63c455,
  // The garden's clipped hedges carry its cooler, denser green signature.
  garden: 0x32b28c,
};

// Fire station: cream drive-through hall, red roof and roll-up bays, hose tower.
export const FIRE_HALL_COLOR = 0xf2ead8;
export const FIRE_ROOF_COLOR = 0xc7473a;
export const FIRE_DOOR_COLOR = 0xd14a3c;
export const FIRE_TRIM_COLOR = 0xf6efe1;
export const FIRE_TOWER_COLOR = SERVICE_WALL_COLORS.fireStation;
export const FIRE_TOWER_CAP_COLOR = 0xa93630;
export const FIRE_LIGHT_COLOR = 0xffc766;
export const FIRE_HALL_HEIGHT = 0.62;
export const FIRE_ROOF_THICK = 0.08;
export const FIRE_DOOR_HEIGHT = 0.48;
export const FIRE_TOWER_HEIGHT = 1.42;
export const FIRE_TOWER_CAP_RISE = 0.18;

// Police station: two-tone block under a slate hip roof, blue sign and beacon.
export const POLICE_BASE_COLOR = 0x4a5a78;
export const POLICE_WALL_COLOR = SERVICE_WALL_COLORS.police;
export const POLICE_ROOF_COLOR = 0x39445c;
export const POLICE_STEP_COLOR = 0xcfc9bb;
export const POLICE_CANOPY_COLOR = 0xe8ecf2;
export const POLICE_POST_COLOR = 0xbfc7d4;
export const POLICE_DOOR_COLOR = 0x2e3a4e;
export const POLICE_SIGN_COLOR = 0x3f6fd1;
export const POLICE_BEACON_COLOR = 0x4f8fe8;
export const POLICE_ANTENNA_COLOR = 0x6b7686;
export const POLICE_FENCE_COLOR = 0xdde2ea;
export const POLICE_BASE_HEIGHT = 0.34;
export const POLICE_WALL_HEIGHT = 0.95;
export const POLICE_ROOF_RISE = 0.23;

// Clinic: white block, glazed entrance, red crosses on facade and roof.
export const CLINIC_WALL_COLOR = SERVICE_WALL_COLORS.clinic;
export const CLINIC_PARAPET_COLOR = 0xdcd8cc;
export const CLINIC_GLASS_COLOR = 0xa9cfe2;
export const CLINIC_CANOPY_COLOR = 0xbcdaea;
export const CLINIC_POST_COLOR = 0xc9d4da;
export const CLINIC_DOOR_COLOR = 0x7fa8c4;
export const CLINIC_CROSS_COLOR = 0xd23c32;
export const CLINIC_APRON_COLOR = 0xd8d4c8;
export const CLINIC_WALL_HEIGHT = 0.92;
export const CLINIC_PARAPET_RISE = 0.07;

// School: two warm gabled wings in an L, flag, clock, fenced play-yard.
export const SCHOOL_WALL_COLOR = SERVICE_WALL_COLORS.school;
export const SCHOOL_ROOF_COLOR = 0xa87549;
export const SCHOOL_WINDOW_COLOR = 0xeef3f5;
export const SCHOOL_DOOR_COLOR = 0x77552f;
export const SCHOOL_CLOCK_COLOR = 0xf4f1e6;
export const SCHOOL_CLOCK_HUB_COLOR = 0x2e3a4e;
export const SCHOOL_POLE_COLOR = 0xcfd4d8;
export const SCHOOL_FLAG_COLOR = 0xd0463a;
export const SCHOOL_YARD_COLOR = 0xdcb87f;
export const SCHOOL_FENCE_COLOR = 0x9b7a52;
export const SCHOOL_WALL_HEIGHT = 0.68;
export const SCHOOL_ROOF_RISE = 0.26;
export const SCHOOL_FLAG_HEIGHT = 1.4;

// Park: mown lawn, gravel cross paths meeting at a fountain plaza, a low-poly
// grove, a stone-rimmed pond, benches, lamps, and flower beds. Deliberately
// wall-less and roofless — it must read as open ground, not a building.
export const PARK_COLORS = {
  lawn: SERVICE_WALL_COLORS.park,
  /** Lighter mown bands striping the lawn; a close-look reward only. */
  mow: 0x86cf62,
  path: 0xd9cfb2,
  plaza: 0xe7dec6,
  /** Shared dressed stone for the pond rim and the fountain basin. */
  stone: 0xc6bfab,
  water: 0x4fb3d9,
  benchSeat: 0xa06f41,
  benchLeg: 0x4f5357,
  lampPost: 0x59626a,
  lampGlobe: 0xffe4a3,
  /** One bed colour per park, drawn from the park's own hash. */
  flowers: [0xe4657f, 0xf2ba44, 0xc06fd2, 0xf08c4e],
} as const;

/**
 * Park composition. `fx`/`fz` are fractions of the 2x2 footprint; radii,
 * thicknesses, and heights above the pad top are absolute world units.
 *
 * The ground layers stack by lift (mow < paths < plaza) so overlapping flat
 * decals never end up coplanar. Tree slots stay at least 0.12 from every edge,
 * which at the widest species radius (0.17) plus slot jitter keeps every canopy
 * inside the footprint — parks must never spill onto a neighbour.
 */
export const PARK_LAYOUT = {
  mowStripes: [0.13, 0.29, 0.71, 0.87],
  mowHalfWidth: 0.055,
  mowLift: 0.004,
  /** Both paths span the pad edge to edge; the inset matches SERVICE_PAD_MARGIN. */
  pathInset: 0.03,
  pathHalfWidth: 0.06,
  pathNorthSouthLift: 0.007,
  pathEastWestLift: 0.009,
  plazaRadius: 0.34,
  plazaLift: 0.012,
  discSegments: 12,
  fountain: {
    basinRadius: 0.2,
    basinTop: 0.13,
    waterRadius: 0.16,
    waterTop: 0.15,
    jetRadius: 0.03,
    jetTopRadius: 0.055,
    jetTop: 0.42,
    segments: 8,
  },
  pond: { fx: 0.79, fz: 0.79, rimRadius: 0.24, rimTop: 0.05, waterRadius: 0.2, waterTop: 0.065 },
  benches: [
    { fx: 0.33, fz: 0.405, alongX: true },
    { fx: 0.67, fz: 0.405, alongX: true },
    { fx: 0.33, fz: 0.595, alongX: true },
    { fx: 0.585, fz: 0.68, alongX: false },
  ],
  bench: {
    halfLength: 0.17,
    halfDepth: 0.055,
    seatBottom: 0.085,
    seatTop: 0.115,
    backTop: 0.27,
    backThick: 0.028,
    legHalf: 0.02,
    legInset: 0.035,
  },
  lamps: [
    { fx: 0.585, fz: 0.3 },
    { fx: 0.415, fz: 0.7 },
  ],
  lamp: { postRadius: 0.022, postTop: 0.46, globeRadius: 0.055, globeBottom: 0.44, globeTop: 0.53 },
  flowerBeds: [
    { fx: 0.31, fz: 0.31 },
    { fx: 0.69, fz: 0.31 },
  ],
  flowerBed: { half: 0.11, top: 0.05 },
  /** A loose perimeter grove: it frames the lawn instead of filling it. */
  treeSlots: [
    { fx: 0.13, fz: 0.14 },
    { fx: 0.33, fz: 0.13 },
    { fx: 0.12, fz: 0.4 },
    { fx: 0.87, fz: 0.14 },
    { fx: 0.67, fz: 0.13 },
    { fx: 0.88, fz: 0.4 },
    { fx: 0.13, fz: 0.66 },
    { fx: 0.14, fz: 0.87 },
    { fx: 0.36, fz: 0.88 },
  ],
  tree: {
    heightScaleMin: 0.84,
    heightScaleRange: 0.28,
    /** Slot jitter, world units, budgeted into the 0.18 edge margin above. */
    jitter: 0.025,
    trunkSegments: 5,
    canopySegments: 7,
  },
} as const;

// Community garden: warm gravel under formal allotment beds, a clipped-hedge
// boundary with a south entrance, and a cream pergola over that entrance.
export const GARDEN_COLORS = {
  ground: 0xd6bd91,
  path: 0xeadbbb,
  hedge: SERVICE_WALL_COLORS.garden,
  bedBorder: 0xa87b52,
  soil: 0x6d4935,
  crops: [0x8ac653, 0xe2b84f, 0xd96b58],
  pergola: 0xf3e8ce,
} as const;

/** Formal, mirrored composition in footprint fractions and world-unit heights. */
export const GARDEN_LAYOUT = {
  path: { x0: 0.46, x1: 0.54, z0: 0.03, z1: 0.97, top: 0.012 },
  bedColumns: [
    { x0: 0.125, x1: 0.375 },
    { x0: 0.625, x1: 0.875 },
  ],
  bedRows: [
    { z0: 0.13, z1: 0.31 },
    { z0: 0.405, z1: 0.595 },
    { z0: 0.69, z1: 0.87 },
  ],
  bed: { borderTop: 0.105, soilInset: 0.025, soilTop: 0.116, cropInset: 0.06, cropTop: 0.14 },
  hedge: { inset: 0.055, thick: 0.045, entranceLeft: 0.42, entranceRight: 0.58, top: 0.24 },
  pergola: {
    left: 0.41,
    right: 0.59,
    north: 0.81,
    south: 0.95,
    postHalf: 0.012,
    postTop: 0.66,
    beamHalf: 0.022,
    beamBottom: 0.64,
    beamTop: 0.71,
    slatHalf: 0.012,
    slatBottom: 0.7,
    slatTop: 0.75,
  },
} as const;

/** One stacked frustum of a park tree's canopy. */
export interface ParkCanopyLayerSpec {
  /** Heights above the pad top, before the per-tree height scale. */
  bottom: number;
  top: number;
  /** Frustum end radii, in world units. */
  r0: number;
  r1: number;
}

export interface ParkTreeSpeciesSpec {
  trunkRadius: number;
  trunkTop: number;
  canopy: readonly ParkCanopyLayerSpec[];
}

/**
 * Park tree species, low-poly like the decorative terrain trees: a trunk plus
 * stacked frustums, coloured from the shared TREE_FOLIAGE_PALETTES so a park's
 * grove belongs to the same forest as the map's. Ornamental scale, well under
 * the terrain trees': nine of these have to frame a 2x2 lawn without closing
 * it in. The widest radius here (0.17) is what PARK_LAYOUT's tree-slot edge
 * margin is budgeted against.
 */
export const PARK_TREE_SPECIES: readonly ParkTreeSpeciesSpec[] = [
  {
    // Broadleaf: a rounded lantern canopy on a tall trunk.
    trunkRadius: 0.04,
    trunkTop: 0.26,
    canopy: [
      { bottom: 0.21, top: 0.38, r0: 0.072, r1: 0.17 },
      { bottom: 0.38, top: 0.64, r0: 0.17, r1: 0.036 },
    ],
  },
  {
    // Conifer: two stacked spires on a short trunk.
    trunkRadius: 0.035,
    trunkTop: 0.17,
    canopy: [
      { bottom: 0.12, top: 0.52, r0: 0.155, r1: 0.022 },
      { bottom: 0.42, top: 0.78, r0: 0.105, r1: 0.009 },
    ],
  },
  {
    // Columnar poplar: narrow, and the tallest thing the park ever grows.
    trunkRadius: 0.032,
    trunkTop: 0.19,
    canopy: [
      { bottom: 0.14, top: 0.56, r0: 0.076, r1: 0.094 },
      { bottom: 0.56, top: 0.88, r0: 0.094, r1: 0.014 },
    ],
  },
] as const;
