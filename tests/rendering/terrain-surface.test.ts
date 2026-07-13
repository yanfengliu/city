import { describe, expect, it } from 'vitest';
import { TERRAIN_MAX_RELIEF, WATER_SURFACE_Y } from '../../src/rendering/constants';
import { TerrainSurface } from '../../src/rendering/terrain-surface';

const data = (
  elevation: readonly number[],
  water: readonly number[] = elevation.map(() => 0),
) => ({
  width: 2,
  height: 2,
  elevation: new Float32Array(elevation),
  water: new Uint8Array(water),
  seaLevel: 0.35,
});

describe('TerrainSurface', () => {
  it('maps normalized elevation into gentle coast-relative relief', () => {
    const surface = new TerrainSurface(data([0.35, 0.6, 0.85, 1]));

    expect(surface.cellHeight(0, 0)).toBe(0);
    expect(surface.cellHeight(1, 0)).toBeGreaterThan(0);
    expect(surface.cellHeight(0, 1)).toBeGreaterThan(surface.cellHeight(1, 0));
    expect(surface.cellHeight(1, 1)).toBeCloseTo(TERRAIN_MAX_RELIEF, 5);
    expect(surface.maxHeight).toBeCloseTo(TERRAIN_MAX_RELIEF, 5);
  });

  it('pins shoreline corners to the coast datum while water stays recessed', () => {
    const surface = new TerrainSurface(data([0.8, 0.2, 0.8, 0.8], [0, 1, 0, 0]));

    expect(surface.cornerHeight(1, 0)).toBe(0);
    expect(surface.cornerHeight(1, 1)).toBe(0);
    expect(surface.heightAt(0.5, 0.5)).toBeGreaterThan(0);
    expect(surface.groundHeightAt(1.5, 0.5)).toBe(WATER_SURFACE_Y);
  });

  it('returns level foundation bounds covering every footprint corner', () => {
    const surface = new TerrainSurface(data([0.35, 0.55, 0.7, 0.85]));
    const range = surface.footprintRange(0, 0, 2, 2);

    expect(range.max).toBeCloseTo(surface.maxHeight, 6);
    expect(range.min).toBeLessThan(range.max);
  });

  it('grades every corner touching a fixed gateway cell to the build datum', () => {
    const surface = new TerrainSurface(data([0.8, 0.8, 0.8, 0.8]), new Set([0]));

    expect(surface.cornerHeight(0, 0)).toBe(0);
    expect(surface.cornerHeight(1, 0)).toBe(0);
    expect(surface.cornerHeight(0, 1)).toBe(0);
    expect(surface.cornerHeight(1, 1)).toBe(0);
    expect(surface.cornerHeight(2, 2)).toBeGreaterThan(0);
  });
});
