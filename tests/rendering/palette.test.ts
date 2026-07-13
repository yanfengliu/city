import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { Color } from 'three';

import {
  ATMOSPHERE_COLORS,
  ATMOSPHERE_LIGHT_INTENSITY,
  BRIDGE_COLOR,
  LAND_COLOR,
  PLANT_COLOR,
  POLE_COLOR,
  PUMP_COLOR,
  SHORE_DETAIL_COLOR,
  STRUCTURE_WALL_COLORS,
  TREE_CANOPY_COLOR,
  TREE_CANOPY_HIGHLIGHT_COLOR,
  TREE_TRUNK_COLOR,
  WATER_COLOR,
} from '../../src/rendering/constants';

const luminance = (hex: number): number => {
  const color = new Color(hex);
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
};

const saturation = (hex: number): number => {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(hex).getHSL(hsl);
  return hsl.s;
};

const colorDistance = (a: number, b: number): number => {
  const first = new Color(a);
  const second = new Color(b);
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b);
};

describe('friendly game palette', () => {
  it('keeps the landscape bright and saturated enough to feel welcoming', () => {
    expect(luminance(LAND_COLOR)).toBeGreaterThanOrEqual(0.42);
    expect(luminance(WATER_COLOR)).toBeGreaterThanOrEqual(0.3);
    expect(luminance(SHORE_DETAIL_COLOR)).toBeGreaterThanOrEqual(0.58);
    expect(luminance(TREE_CANOPY_COLOR)).toBeGreaterThanOrEqual(0.18);
    expect(luminance(TREE_CANOPY_HIGHLIGHT_COLOR)).toBeGreaterThan(luminance(TREE_CANOPY_COLOR));
    for (const color of [LAND_COLOR, WATER_COLOR, SHORE_DETAIL_COLOR, TREE_CANOPY_COLOR]) {
      expect(saturation(color)).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('keeps supporting infrastructure lighter without erasing material identity', () => {
    expect(luminance(BRIDGE_COLOR)).toBeGreaterThanOrEqual(0.35);
    expect(saturation(TREE_TRUNK_COLOR)).toBeGreaterThanOrEqual(0.4);
    expect(luminance(PLANT_COLOR)).toBeGreaterThanOrEqual(0.18);
    expect(saturation(POLE_COLOR)).toBeGreaterThanOrEqual(0.35);
    expect(luminance(PUMP_COLOR)).toBeGreaterThanOrEqual(0.25);
    expect(saturation(PUMP_COLOR)).toBeGreaterThanOrEqual(0.5);
  });

  it('uses a bright blue daytime sky and a readable dusk instead of slate', () => {
    expect(luminance(ATMOSPHERE_COLORS.skyTopDay)).toBeGreaterThanOrEqual(0.32);
    expect(luminance(ATMOSPHERE_COLORS.skyHorizonDay)).toBeGreaterThanOrEqual(0.75);
    expect(luminance(ATMOSPHERE_COLORS.skyHorizonNight)).toBeGreaterThanOrEqual(0.3);
    expect(ATMOSPHERE_LIGHT_INTENSITY.sunBase).toBeGreaterThanOrEqual(1.1);
    expect(
      ATMOSPHERE_LIGHT_INTENSITY.sunBase + ATMOSPHERE_LIGHT_INTENSITY.sunDaylightBoost,
    ).toBeGreaterThanOrEqual(2.8);
    expect(ATMOSPHERE_LIGHT_INTENSITY.hemisphereBase).toBeGreaterThanOrEqual(1);
    expect(
      ATMOSPHERE_LIGHT_INTENSITY.hemisphereBase +
        ATMOSPHERE_LIGHT_INTENSITY.hemisphereNightBoost,
    ).toBeGreaterThanOrEqual(1.5);
    const sceneSource = readFileSync(new URL('../../src/rendering/scene.ts', import.meta.url), 'utf8');
    const toneMapping = sceneSource.indexOf('#include <tonemapping_fragment>');
    const colorSpace = sceneSource.indexOf('#include <colorspace_fragment>');
    expect(toneMapping).toBeGreaterThan(0);
    expect(colorSpace).toBeGreaterThan(toneMapping);
  });

  it('avoids near-black civic service walls', () => {
    const colors = Object.values(STRUCTURE_WALL_COLORS);
    for (const color of colors) {
      expect(luminance(color)).toBeGreaterThanOrEqual(0.18);
      expect(saturation(color)).toBeGreaterThanOrEqual(0.4);
    }
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        expect(colorDistance(colors[i], colors[j])).toBeGreaterThanOrEqual(0.18);
      }
    }
  });
});
