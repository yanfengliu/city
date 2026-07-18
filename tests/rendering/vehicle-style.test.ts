import { describe, expect, it } from 'vitest';
import {
  VEHICLE_LANE_OFFSET,
  VEHICLE_PAINT_PALETTE,
  vehicleAppearance,
} from '../../src/rendering/vehicle-style';

describe('vehicleAppearance', () => {
  it('is stable for one vehicle identity across calls', () => {
    for (const [id, generation] of [[1, 0], [77, 3], [512, 12]] as const) {
      expect(vehicleAppearance(id, generation)).toEqual(vehicleAppearance(id, generation));
    }
  });

  it('draws paint from the palette and keeps proportions near the base body', () => {
    for (let id = 0; id < 60; id++) {
      const look = vehicleAppearance(id, id % 5);
      expect(VEHICLE_PAINT_PALETTE).toContain(look.paint);
      for (const scale of [look.widthScale, look.heightScale, look.lengthScale]) {
        expect(scale).toBeGreaterThanOrEqual(0.85);
        expect(scale).toBeLessThanOrEqual(1.2);
      }
    }
  });

  it('spreads looks across a fleet instead of cloning one car', () => {
    const paints = new Set<number>();
    const shapes = new Set<string>();
    for (let id = 0; id < 100; id++) {
      const look = vehicleAppearance(id, 0);
      paints.add(look.paint);
      shapes.add(`${look.widthScale}:${look.heightScale}:${look.lengthScale}`);
    }
    expect(paints.size).toBeGreaterThanOrEqual(5);
    expect(shapes.size).toBeGreaterThanOrEqual(3);
  });

  it('recycled ids with a new generation may repaint (identity includes generation)', () => {
    const looks = new Set<string>();
    for (let generation = 0; generation < 12; generation++) {
      const look = vehicleAppearance(42, generation);
      looks.add(`${look.paint}:${look.widthScale}`);
    }
    expect(looks.size).toBeGreaterThan(1);
  });

  it('keeps opposing lanes apart by a real half-gap', () => {
    expect(VEHICLE_LANE_OFFSET).toBeGreaterThan(0.1);
    expect(VEHICLE_LANE_OFFSET).toBeLessThan(0.35);
  });
});
