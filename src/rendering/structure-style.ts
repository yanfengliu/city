import type { ServiceKind } from './constants';
import { UTILITY_PAD_COLOR, UTILITY_PAD_LIFT } from './utility-structure-style';

/**
 * Dimensions and palette for the detailed coverage-service models (fire
 * station, police station, clinic, school). Rendering-only; footprints and
 * placement rules stay in src/sim/constants/services.ts. Lengths are world
 * units (1 = one grid cell); model-local heights are measured above the pad
 * top. Layout offsets inside the 2x2 footprint live with the geometry in
 * service-structures.ts as footprint fractions.
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
