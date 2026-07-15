import { PLANT_COLOR, PUMP_COLOR } from './constants';

/**
 * Dimensions and palette for the detailed utility-structure models (coal
 * plant, wind turbine, water pump). Rendering-only; footprints and placement
 * rules stay in src/sim/constants/utilities.ts. Lengths are world units
 * (1 = one grid cell); model-local heights are measured above the pad top.
 */

// Every utility structure stands on a leveled concrete pad.
export const UTILITY_PAD_LIFT = 0.05;
export const UTILITY_PAD_MARGIN = 0.04;
export const UTILITY_PAD_COLOR = 0xb9b2a6;

// Coal plant (3×3): turbine hall + boiler house + banded stacks + coal yard.
export const COAL_HALL_COLOR = PLANT_COLOR;
export const COAL_HALL_ROOF_COLOR = 0x5a6169;
export const COAL_DOOR_COLOR = 0x3f464c;
export const COAL_BOILER_COLOR = 0x99a1a9;
export const COAL_STACK_COLOR = 0xd8d2c6;
export const COAL_STACK_STRIPE_RED = 0xd25f4f;
export const COAL_STACK_STRIPE_WHITE = 0xece7dc;
export const COAL_CONDENSER_COLOR = 0xa7aeb6;
export const COAL_RIB_COLOR = 0x6e767e;
export const COAL_PILE_COLOR = 0x3a3d42;
export const COAL_CONVEYOR_COLOR = 0x687079;
export const COAL_STACK_HEIGHT = 2.3;
export const COAL_STACK_RADIUS = 0.15;
export const COAL_STACK_TOP_RADIUS = 0.115;
export const COAL_STACK_SEGMENTS = 8;
/** How far the aviation bands sit proud of the stack surface at their height. */
export const COAL_STACK_BAND_PROUD = 0.012;

// Wind turbine (1×1): slender tapered mast, wind-facing nacelle, spinning rotor.
export const WIND_TOWER_HEIGHT = 1.9;
export const WIND_TOWER_BASE_RADIUS = 0.09;
export const WIND_TOWER_TOP_RADIUS = 0.055;
export const WIND_TOWER_SEGMENTS = 8;
export const WIND_TOWER_COLOR = 0xe9ecef;
export const WIND_NACELLE_COLOR = 0xd3d8dd;
export const WIND_BLADE_COLOR = 0xf2f4f6;
export const WIND_PAD_SIZE = 0.6;
/** Nacelle runs along the wind axis: tail behind the mast, nose upwind. */
export const WIND_NACELLE_TAIL = 0.14;
export const WIND_NACELLE_NOSE = 0.26;
export const WIND_NACELLE_WIDTH = 0.13;
export const WIND_NACELLE_HEIGHT = 0.12;
/** Rotor hub (blade plane) offset upwind of the mast axis. */
export const WIND_HUB_FORWARD = 0.24;
export const WIND_ROTOR_RADIUS = 0.52;
/** Presentation-only rotor speed (rad/s) — like the water wind, it keeps
 * turning while the simulation is paused and never enters save state. */
export const WIND_ROTOR_SPEED = 1.1;

// Water pump (1×1): lakeside pump house whose intake reaches into the water.
export const PUMP_HOUSE_COLOR = 0xe9e2d2;
export const PUMP_ROOF_COLOR = PUMP_COLOR;
export const PUMP_TANK_COLOR = PUMP_COLOR;
export const PUMP_PIPE_COLOR = 0x5d7383;
export const PUMP_VALVE_COLOR = 0xd25f4f;
export const PUMP_INTAKE_RADIUS = 0.055;
/** How far past the shared cell edge the intake reaches over the water. */
export const PUMP_INTAKE_REACH = 0.32;
export const PUMP_TUBE_SEGMENTS = 6;
