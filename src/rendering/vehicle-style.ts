/**
 * Per-car identity styling (docs/design/simulation-realism.md T1): paint and
 * body proportions are a pure function of the sim's (id, generation), so a
 * car keeps one look for its whole trip across frames, saves, and replays —
 * and congestion never recolors cars (that is the traffic overlay's job).
 */

/** Right-hand traffic: render-side perpendicular offset from the road center. */
export const VEHICLE_LANE_OFFSET = 0.18;

/** Muted everyday city-car paints (sRGB hex). */
export const VEHICLE_PAINT_PALETTE: readonly number[] = [
  0xd9dde2, // silver
  0xf4f2ec, // white
  0x2e3338, // charcoal
  0x9a2f2a, // red
  0x2f4d7c, // blue
  0x3d6b57, // green
  0xc7a659, // sand
  0x6e5a8a, // plum
  0x8f9aa5, // grey-blue
  0x7c4a32, // rust
] as const;

const WIDTH_SCALES = [0.92, 1, 1.06] as const;
const HEIGHT_SCALES = [0.88, 1, 1.14] as const;
const LENGTH_SCALES = [0.9, 1, 1.12] as const;

export interface VehicleAppearance {
  paint: number;
  widthScale: number;
  heightScale: number;
  lengthScale: number;
}

function mix32(value: number): number {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Stable for one live vehicle identity; a recycled id gets a fresh look. */
export function vehicleAppearance(id: number, generation: number): VehicleAppearance {
  const base = (
    Math.imul((id + 1) | 0, 0x9e3779b1) ^
    Math.imul((generation + 1) | 0, 0x85ebca6b)
  ) | 0;
  const index = (salt: number, length: number): number => mix32(base ^ salt) % length;
  return {
    paint: VEHICLE_PAINT_PALETTE[index(0x1b56c4e9, VEHICLE_PAINT_PALETTE.length)],
    widthScale: WIDTH_SCALES[index(0x63f7a2d1, WIDTH_SCALES.length)],
    heightScale: HEIGHT_SCALES[index(0x2f8e4b17, HEIGHT_SCALES.length)],
    lengthScale: LENGTH_SCALES[index(0x51d3b96f, LENGTH_SCALES.length)],
  };
}
