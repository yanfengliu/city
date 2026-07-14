import type { PedestrianPurpose } from '../protocol/messages';
import { SIDEWALK_Y } from './road-streetscape-style';

export const PEDESTRIAN_PURPOSE_TOP_PALETTES: Record<
  PedestrianPurpose,
  readonly number[]
> = {
  'commercial-work': [
    0x3478a8, 0x2d5f87, 0x4b8fb4, 0x376f73,
    0x4f6f96, 0x506d7b, 0x3f8191, 0x5560a0,
  ],
  'industrial-work': [
    0xd8892b, 0xb9672d, 0xc47a3f, 0x9c6b2f,
    0xa9553b, 0x7e6f3b, 0xa0794d, 0xc05f31,
  ],
  shopping: [
    0xb4548c, 0x8f4a70, 0xa65d7c, 0x76558f,
    0xc26472, 0x8d547c, 0x9b4d55, 0x6d567d,
  ],
};

export const PEDESTRIAN_BOTTOM_COLORS = [
  0x24313b, 0x35485c, 0x4d433b, 0x5c5144,
  0x3f4a3a, 0x554758, 0x6c604b, 0x2f343a,
] as const;

export const PEDESTRIAN_SKIN_COLORS = [
  0x5a3828, 0x7b4c35, 0x9c6549, 0xba7d5b, 0xd49b72, 0xe6b98b,
] as const;

const WIDTH_SCALES = [0.9, 1, 1.1] as const;
const HEIGHT_SCALES = [0.92, 1, 1.08] as const;

/** Feet sit just above the raised sidewalk top. */
export const PEDESTRIAN_Y = SIDEWALK_Y + 0.01;

export interface PedestrianStyle {
  topColor: number;
  bottomColor: number;
  skinColor: number;
  widthScale: number;
  heightScale: number;
}

function mix32(value: number): number {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Stable for one live pedestrian identity; a recycled generation gets a new outfit. */
export function pedestrianStyle(
  id: number,
  generation: number,
  purpose: PedestrianPurpose,
): PedestrianStyle {
  const base = (
    Math.imul((id + 1) | 0, 0x9e3779b1) ^
    Math.imul((generation + 1) | 0, 0x85ebca6b)
  ) | 0;
  const index = (salt: number, length: number): number => mix32(base ^ salt) % length;
  const topPalette = PEDESTRIAN_PURPOSE_TOP_PALETTES[purpose];
  return {
    topColor: topPalette[index(0x2c1b3c6d, topPalette.length)],
    bottomColor: PEDESTRIAN_BOTTOM_COLORS[index(0x5a17d9e3, PEDESTRIAN_BOTTOM_COLORS.length)],
    skinColor: PEDESTRIAN_SKIN_COLORS[index(0x7f4a7c15, PEDESTRIAN_SKIN_COLORS.length)],
    heightScale: HEIGHT_SCALES[index(0x35a6d12b, HEIGHT_SCALES.length)],
    widthScale: WIDTH_SCALES[index(0x68e31da4, WIDTH_SCALES.length)],
  };
}
