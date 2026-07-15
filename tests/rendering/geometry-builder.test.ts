import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { GeometryBuilder } from '../../src/rendering/geometry-builder';

describe('geometry builder solids', () => {
  it('keeps tube vertices within the larger end radius of its axis', () => {
    const builder = new GeometryBuilder();
    const from = new Vector3(1, 0.5, 2);
    const to = new Vector3(1, 2.5, 2);
    builder.coloredTube([from.x, from.y, from.z], [to.x, to.y, to.z], 0.3, 0.15, 8, 0xffffff);
    const positions = builder.build().getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    const axis = to.clone().sub(from).normalize();
    for (let i = 0; i < positions.count; i++) {
      const p = new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).sub(from);
      const along = p.dot(axis);
      expect(along).toBeGreaterThanOrEqual(-1e-5);
      expect(along).toBeLessThanOrEqual(2 + 1e-5);
      const radial = p.sub(axis.clone().multiplyScalar(along)).length();
      expect(radial).toBeLessThanOrEqual(0.3 + 1e-5);
    }
  });

  it('tapers beams between their end cross-sections without drifting off axis', () => {
    const builder = new GeometryBuilder();
    builder.coloredBeam([0, 0, 0], [2, 0, 0], [0, 1, 0], 0.4, 0.2, 0.1, 0.05, 0xffffff);
    const positions = builder.build().getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const t = x / 2;
      const halfWidth = (0.4 * (1 - t) + 0.1 * t) / 2;
      const halfThick = (0.2 * (1 - t) + 0.05 * t) / 2;
      expect(x).toBeGreaterThanOrEqual(-1e-5);
      expect(x).toBeLessThanOrEqual(2 + 1e-5);
      expect(Math.abs(positions.getZ(i))).toBeLessThanOrEqual(halfWidth + 1e-5);
      expect(Math.abs(positions.getY(i))).toBeLessThanOrEqual(halfThick + 1e-5);
    }
  });
});
