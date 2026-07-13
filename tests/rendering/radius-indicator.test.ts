import { describe, expect, it } from 'vitest';
import { Line, Mesh } from 'three';
import type { BufferAttribute } from 'three';
import { RADIUS_Y } from '../../src/rendering/constants';
import { RadiusIndicator } from '../../src/rendering/radius-indicator';
import { TerrainSurface } from '../../src/rendering/terrain-surface';

describe('RadiusIndicator', () => {
  it('drapes its fill and perimeter over the shared terrain surface', () => {
    const width = 6;
    const height = 6;
    const elevation = new Float32Array(width * height);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) elevation[z * width + x] = 0.4 + (x + z) * 0.04;
    }
    const surface = new TerrainSurface({
      width,
      height,
      elevation,
      seaLevel: 0.35,
      water: new Uint8Array(width * height),
    });
    const indicator = new RadiusIndicator();
    indicator.setTerrainSurface(surface);
    indicator.show(1, 1, 2, 2);

    const fill = indicator.group.getObjectByName('radius-fill');
    const border = indicator.group.getObjectByName('radius-border');
    expect(fill).toBeInstanceOf(Mesh);
    expect(border).toBeInstanceOf(Line);
    const fillPositions = (fill as Mesh).geometry.getAttribute('position') as BufferAttribute;
    expect(fillPositions.count).toBe(16);
    for (let i = 0; i < fillPositions.count; i++) {
      expect(fillPositions.getY(i)).toBeCloseTo(
        surface.heightAt(fillPositions.getX(i), fillPositions.getZ(i)) + RADIUS_Y,
        5,
      );
    }
    const borderPositions = (border as Line).geometry.getAttribute('position') as BufferAttribute;
    expect(borderPositions.count).toBe(9);
    for (let i = 0; i < borderPositions.count; i++) {
      expect(borderPositions.getY(i)).toBeCloseTo(
        surface.heightAt(borderPositions.getX(i), borderPositions.getZ(i)) + RADIUS_Y + 0.002,
        5,
      );
    }

    const fillGeometry = (fill as Mesh).geometry;
    const borderGeometry = (border as Line).geometry;
    indicator.show(1, 1, 2, 2);
    expect((fill as Mesh).geometry).toBe(fillGeometry);
    expect((border as Line).geometry).toBe(borderGeometry);
  });
});
