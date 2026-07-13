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

const terrain = (water: Uint8Array, elevation = new Float32Array(water.length).fill(0.35)) => ({
  width: 3,
  height: 3,
  water,
  elevation,
  seaLevel: 0.35,
});

describe('buildTerrainMesh', () => {
  it('adds deterministic sandy shoreline detail strips below gameplay overlays', () => {
    const water = new Uint8Array(9);
    water[4] = 1;

    const root = buildTerrainMesh(terrain(water));
    const land = mesh(root, 'terrain-land');
    const waterSurface = mesh(root, 'terrain-water');
    const shoreDetails = mesh(root, 'terrain-shore-details');

    expect(land.receiveShadow).toBe(true);
    expect(waterSurface.receiveShadow).toBe(true);
    expect(shoreDetails.receiveShadow).toBe(true);

    const positions = shoreDetails.geometry.getAttribute('position') as BufferAttribute;
    const colors = shoreDetails.geometry.getAttribute('color') as BufferAttribute;
    // The four strips are split along each underlying terrain triangle seam.
    expect(positions.count).toBe(28);
    expect(colors.count).toBe(positions.count);
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
    const root = buildTerrainMesh(terrain(new Uint8Array(9)));
    const positions = mesh(root, 'terrain-shore-details').geometry.getAttribute('position') as BufferAttribute;

    expect(positions.count).toBe(0);
  });

  it('crops adjacent shoreline strips so corner coastlines do not overlap', () => {
    const water = new Uint8Array(9);
    water[1] = 1;
    water[3] = 1;

    const root = buildTerrainMesh(terrain(water));
    const positions = mesh(root, 'terrain-shore-details').geometry.getAttribute('position') as BufferAttribute;

    for (let i = 0; i < positions.count; i++) {
      const x = Number(positions.getX(i).toFixed(3));
      const z = Number(positions.getZ(i).toFixed(3));
      expect(`${x},${z}`).not.toBe('1,1');
    }
  });

  it('raises land vertices and derives non-flat normals from the shared surface', () => {
    const elevation = new Float32Array([
      0.35, 0.5, 0.7,
      0.45, 0.6, 0.8,
      0.55, 0.7, 0.85,
    ]);
    const root = buildTerrainMesh(terrain(new Uint8Array(9), elevation));
    const land = mesh(root, 'terrain-land');
    const positions = land.geometry.getAttribute('position') as BufferAttribute;
    const normals = land.geometry.getAttribute('normal') as BufferAttribute;

    const yValues = Array.from({ length: positions.count }, (_, i) => positions.getY(i));
    expect(Math.max(...yValues)).toBeGreaterThan(0.2);
    expect(Array.from({ length: normals.count }, (_, i) => normals.getX(i)).some((x) => Math.abs(x) > 0.001)).toBe(true);
  });
});
