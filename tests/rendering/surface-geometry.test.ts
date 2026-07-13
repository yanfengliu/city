import { describe, expect, it } from 'vitest';
import { buildSurfacePatch } from '../../src/rendering/surface-geometry';
import type { TerrainSurfaceView } from '../../src/rendering/terrain-surface';

describe('buildSurfacePatch', () => {
  it('splits an inset rectangle along the terrain triangle seam', () => {
    const heightAt = (x: number, z: number): number => {
      if (x + z <= 1) return 0.2 * x + 0.4 * z;
      return 1 + (0.4 - 1) * (1 - x) + (0.2 - 1) * (1 - z);
    };
    const surface: TerrainSurfaceView = {
      width: 1,
      height: 1,
      minHeight: 0,
      maxHeight: 1,
      cellHeight: heightAt,
      cornerHeight: heightAt,
      heightAt,
      groundHeightAt: heightAt,
      footprintRange: () => ({ min: 0, max: 1 }),
    };

    const patch = buildSurfacePatch(surface, 0.2, 0.2, 0.8, 0.8, 0.01);

    expect(patch.positions).toHaveLength(18);
    expect(patch.indices).toHaveLength(6);
    for (let i = 0; i < patch.positions.length; i += 3) {
      expect(patch.positions[i + 1]).toBeCloseTo(
        surface.heightAt(patch.positions[i], patch.positions[i + 2]) + 0.01,
        6,
      );
    }
    for (let i = 0; i < patch.indices.length; i += 3) {
      const seamDistances = patch.indices.slice(i, i + 3).map((index) =>
        patch.positions[index * 3] + patch.positions[index * 3 + 2] - 1,
      );
      expect(
        seamDistances.every((distance) => distance <= 1e-6) ||
          seamDistances.every((distance) => distance >= -1e-6),
      ).toBe(true);
    }
  });
});
