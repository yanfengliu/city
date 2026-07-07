import { describe, expect, it } from 'vitest';
import { Mesh, MeshLambertMaterial } from 'three';
import type { BufferAttribute } from 'three';
import { SHORE_DETAIL_Y, ZONE_SURFACE_Y } from '../../src/rendering/constants';
import { buildTerrainMesh } from '../../src/rendering/terrain-mesh';

const mesh = (root: ReturnType<typeof buildTerrainMesh>, name: string): Mesh => {
  const child = root.getObjectByName(name);
  expect(child).toBeInstanceOf(Mesh);
  return child as Mesh;
};

describe('buildTerrainMesh', () => {
  it('adds deterministic sandy shoreline detail strips below gameplay overlays', () => {
    const water = new Uint8Array(9);
    water[4] = 1;

    const root = buildTerrainMesh({ width: 3, height: 3, water });
    const land = mesh(root, 'terrain-land');
    const waterSurface = mesh(root, 'terrain-water');
    const shoreDetails = mesh(root, 'terrain-shore-details');

    expect(land.receiveShadow).toBe(true);
    expect(waterSurface.receiveShadow).toBe(true);
    expect(shoreDetails.receiveShadow).toBe(true);

    const positions = shoreDetails.geometry.getAttribute('position') as BufferAttribute;
    const colors = shoreDetails.geometry.getAttribute('color') as BufferAttribute;
    expect(positions.count).toBe(16);
    expect(colors.count).toBe(16);
    expect(shoreDetails.material).toBeInstanceOf(MeshLambertMaterial);
    const material = shoreDetails.material as MeshLambertMaterial;
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeLessThan(0);

    const yValues = new Set<number>();
    for (let i = 0; i < positions.count; i++) yValues.add(Number(positions.getY(i).toFixed(3)));

    expect([...yValues]).toHaveLength(1);
    const y = [...yValues][0];
    expect(y).toBeCloseTo(SHORE_DETAIL_Y, 3);
    expect(y).toBeLessThan(ZONE_SURFACE_Y);
  });

  it('does not draw top shoreline details for map boundaries alone', () => {
    const root = buildTerrainMesh({ width: 3, height: 3, water: new Uint8Array(9) });
    const positions = mesh(root, 'terrain-shore-details').geometry.getAttribute('position') as BufferAttribute;

    expect(positions.count).toBe(0);
  });

  it('crops adjacent shoreline strips so corner coastlines do not overlap', () => {
    const water = new Uint8Array(9);
    water[1] = 1;
    water[3] = 1;

    const root = buildTerrainMesh({ width: 3, height: 3, water });
    const positions = mesh(root, 'terrain-shore-details').geometry.getAttribute('position') as BufferAttribute;

    for (let i = 0; i < positions.count; i++) {
      const x = Number(positions.getX(i).toFixed(3));
      const z = Number(positions.getZ(i).toFixed(3));
      expect(`${x},${z}`).not.toBe('1,1');
    }
  });
});
