import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import {
  WATER_DEEP_COLOR,
  WATER_DEEP_ELEVATION_DELTA,
  WATER_MID_COLOR,
  WATER_MID_DEPTH,
  WATER_SHALLOW_COLOR,
} from '../../src/rendering/constants';
import {
  buildWaterCornerDepths,
  waterDepthColor,
  waterDepth01,
} from '../../src/rendering/water-depth';

const luminance = (color: Color): number =>
  0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

const distance = (a: Color, b: Color): number =>
  Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

describe('water bathymetry presentation', () => {
  it('pins the friendly palette and fixed depth stops', () => {
    expect(WATER_SHALLOW_COLOR).toBe(0x69c8c5);
    expect(WATER_MID_COLOR).toBe(0x49a6d7);
    expect(WATER_DEEP_COLOR).toBe(0x3d8dc5);
    expect(WATER_DEEP_ELEVATION_DELTA).toBe(0.18);
    expect(WATER_MID_DEPTH).toBeCloseTo(1 / 3, 12);
  });

  it('normalizes seeded elevation below sea level into a clamped depth', () => {
    const seaLevel = 0.35;

    expect(waterDepth01(seaLevel, seaLevel)).toBe(0);
    expect(waterDepth01(seaLevel - WATER_DEEP_ELEVATION_DELTA / 2, seaLevel))
      .toBeCloseTo(0.5, 6);
    expect(waterDepth01(seaLevel - WATER_DEEP_ELEVATION_DELTA, seaLevel)).toBe(1);
    expect(waterDepth01(-1, seaLevel)).toBe(1);
    expect(waterDepth01(1, seaLevel)).toBe(0);
  });

  it('smooths depth across water while pinning land-touching corners to shallow', () => {
    const water = new Uint8Array(9).fill(1);
    const elevation = new Float32Array([
      0.34, 0.30, 0.28,
      0.26, 0.17, 0.22,
      0.31, 0.24, 0.19,
    ]);
    const terrain = { width: 3, height: 3, elevation, seaLevel: 0.35, water };
    const depths = buildWaterCornerDepths(terrain);
    const stride = terrain.width + 1;
    const expectedInterior = [0, 1, 3, 4]
      .map((index) => waterDepth01(elevation[index] ?? 0, terrain.seaLevel))
      .reduce((sum, depth) => sum + depth, 0) / 4;

    expect(depths).toHaveLength(16);
    expect(depths[stride + 1]).toBeCloseTo(expectedInterior, 6);

    water[0] = 0;
    const shoreDepths = buildWaterCornerDepths(terrain);
    expect(shoreDepths[stride + 1]).toBe(0);
  });

  it('uses a friendly but legible shallow-to-deep three-stop ramp', () => {
    const shallow = waterDepthColor(0, new Color());
    const middle = waterDepthColor(WATER_MID_DEPTH, new Color());
    const deep = waterDepthColor(1, new Color());

    expect(shallow.getHex()).toBe(WATER_SHALLOW_COLOR);
    expect(middle.getHex()).toBe(WATER_MID_COLOR);
    expect(deep.getHex()).toBe(WATER_DEEP_COLOR);
    expect(luminance(shallow)).toBeGreaterThan(luminance(middle));
    expect(luminance(middle)).toBeGreaterThan(luminance(deep));
    expect(luminance(deep)).toBeGreaterThan(0.12);
    expect(distance(shallow, middle)).toBeGreaterThan(0.2);
    expect(distance(middle, deep)).toBeGreaterThan(0.15);
  });
});
