/** Renderer-only street furniture tuning; no simulation behavior lives here. */
export const SIDEWALK_COLOR = 0xb9b3a8;
export const SIDEWALK_WIDTH = 0.24;
/** Top of the sidewalk above the terrain sample. */
export const SIDEWALK_Y = 0.04;

export const TRAFFIC_SIGNAL_POLE_COLOR = 0x30383c;
export const TRAFFIC_SIGNAL_HOUSING_COLOR = 0x1e2529;
export const TRAFFIC_SIGNAL_ACTIVE_RED = 0xf24f45;
export const TRAFFIC_SIGNAL_INACTIVE_RED = 0x4a211f;
export const TRAFFIC_SIGNAL_DIM_AMBER = 0x59451f;
export const TRAFFIC_SIGNAL_ACTIVE_GREEN = 0x4bd477;
export const TRAFFIC_SIGNAL_INACTIVE_GREEN = 0x1d4930;

export const TRAFFIC_SIGNAL_CORNER_INSET = 0.16;
export const TRAFFIC_SIGNAL_POLE_HALF_WIDTH = 0.018;
export const TRAFFIC_SIGNAL_POLE_HEIGHT = 0.34;
export const TRAFFIC_SIGNAL_HOUSING_BOTTOM = 0.29;
export const TRAFFIC_SIGNAL_HOUSING_TOP = 0.57;
export const TRAFFIC_SIGNAL_HOUSING_WIDTH = 0.14;
export const TRAFFIC_SIGNAL_HOUSING_DEPTH = 0.075;
export const TRAFFIC_SIGNAL_LENS_HALF_SIZE = 0.023;
export const TRAFFIC_SIGNAL_LENS_DEPTH = 0.012;
export const TRAFFIC_SIGNAL_LENS_HEIGHTS = [0.5, 0.43, 0.36] as const;
