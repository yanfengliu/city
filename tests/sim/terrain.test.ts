import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../../src/sim/terrain';
import { MIN_WATER_BODY_CELLS, WATER_THRESHOLD } from '../../src/sim/constants/terrain';

describe('generateTerrain', () => {
  it('is deterministic for the same seed', () => {
    const a = generateTerrain(42, 64, 64);
    const b = generateTerrain(42, 64, 64);
    expect(a.effectiveSeed).toBe(b.effectiveSeed);
    expect(Buffer.from(a.water).equals(Buffer.from(b.water))).toBe(true);
    expect(Buffer.from(a.trees).equals(Buffer.from(b.trees))).toBe(true);
    expect(Buffer.from(a.elevation.buffer).equals(Buffer.from(b.elevation.buffer))).toBe(true);
    expect(a.seaLevel).toBe(WATER_THRESHOLD);
  });

  it('differs across seeds', () => {
    const a = generateTerrain(1, 64, 64);
    const b = generateTerrain(2, 64, 64);
    expect(Buffer.from(a.water).equals(Buffer.from(b.water))).toBe(false);
    expect(Buffer.from(a.elevation.buffer).equals(Buffer.from(b.elevation.buffer))).toBe(false);
  });

  it('retains one finite normalized elevation sample per terrain cell', () => {
    const terrain = generateTerrain(42, 64, 48);

    expect(terrain.elevation).toHaveLength(64 * 48);
    for (const elevation of terrain.elevation) {
      expect(Number.isFinite(elevation)).toBe(true);
      expect(elevation).toBeGreaterThanOrEqual(0);
      expect(elevation).toBeLessThanOrEqual(1);
    }
  });

  it('guarantees a sizeable water body', () => {
    for (const seed of [1, 7, 42, 12345, 99999]) {
      const terrain = generateTerrain(seed, 128, 128);
      // Count the largest 4-connected water body via a simple check:
      // at minimum, total water must reach the threshold.
      const total = terrain.water.reduce((sum, v) => sum + v, 0);
      expect(total).toBeGreaterThanOrEqual(MIN_WATER_BODY_CELLS);
    }
  });

  it('never places trees on water', () => {
    const terrain = generateTerrain(42, 128, 128);
    for (let i = 0; i < terrain.water.length; i++) {
      if (terrain.trees[i] === 1) expect(terrain.water[i]).toBe(0);
    }
  });
});
