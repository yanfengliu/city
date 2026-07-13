import { describe, expect, it } from 'vitest';
import { Color, Mesh, MeshLambertMaterial, MeshStandardMaterial } from 'three';
import type { BufferAttribute } from 'three';
import { SHORE_DETAIL_Y, ZONE_SURFACE_Y } from '../../src/rendering/constants';
import { buildTerrainMesh } from '../../src/rendering/terrain-mesh';
import { waterDepthColor } from '../../src/rendering/water-depth';

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

  it('renders flat water with continuous vertex colors derived from seeded depth', () => {
    const water = new Uint8Array(9).fill(1);
    const elevation = new Float32Array([
      0.349, 0.32, 0.28,
      0.30, 0.24, 0.18,
      0.27, 0.20, 0.10,
    ]);
    const root = buildTerrainMesh(terrain(water, elevation));
    const waterSurface = mesh(root, 'terrain-water');
    const repeatedWater = mesh(buildTerrainMesh(terrain(water, elevation)), 'terrain-water');
    const positions = waterSurface.geometry.getAttribute('position') as BufferAttribute;
    const colors = waterSurface.geometry.getAttribute('color') as BufferAttribute;
    const repeatedColors = repeatedWater.geometry.getAttribute('color') as BufferAttribute;

    expect(colors.count).toBe(positions.count);
    expect(waterSurface.material).toBeInstanceOf(MeshStandardMaterial);
    const material = waterSurface.material as MeshStandardMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);
    const waterMeshes: Mesh[] = [];
    root.traverse((object) => {
      if (object.name === 'terrain-water') waterMeshes.push(object as Mesh);
    });
    expect(waterMeshes).toHaveLength(1);
    const uniqueColors = new Set<string>();
    const yValues = new Set<number>();
    for (let i = 0; i < positions.count; i++) {
      uniqueColors.add(`${colors.getX(i).toFixed(3)},${colors.getY(i).toFixed(3)},${colors.getZ(i).toFixed(3)}`);
      yValues.add(Number(positions.getY(i).toFixed(3)));
    }
    expect(uniqueColors.size).toBeGreaterThanOrEqual(5);
    expect(yValues.size).toBe(1);
    expect(Array.from(colors.array)).toEqual(Array.from(repeatedColors.array));
  });

  it('maps asymmetric water-grid corner depths to matching x and z vertices', () => {
    const seaLevel = 0.35;
    const cellDepths = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const root = buildTerrainMesh({
      width: 2,
      height: 3,
      water: new Uint8Array(6).fill(1),
      elevation: new Float32Array(
        cellDepths.map((depth) => seaLevel - depth * 0.18),
      ),
      seaLevel,
    });
    const waterSurface = mesh(root, 'terrain-water');
    const positions = waterSurface.geometry.getAttribute('position') as BufferAttribute;
    const colors = waterSurface.geometry.getAttribute('color') as BufferAttribute;
    const expectedCornerDepths = [
      [0, 0.1, 0.2],
      [0.2, 0.3, 0.4],
      [0.6, 0.7, 0.8],
      [0.8, 0.9, 1],
    ];

    expect(positions.count).toBe(24);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const expectedDepth = expectedCornerDepths[z]?.[x];
      expect(expectedDepth).toBeDefined();
      const expected = waterDepthColor(expectedDepth ?? 0, new Color());
      expect(colors.getX(i)).toBeCloseTo(expected.r, 6);
      expect(colors.getY(i)).toBeCloseTo(expected.g, 6);
      expect(colors.getZ(i)).toBeCloseTo(expected.b, 6);
    }
  });

  it('keeps the water mask authoritative when elevation data disagrees', () => {
    const water = new Uint8Array(9);
    water[4] = 1;
    const elevation = new Float32Array(9).fill(0.1);
    elevation[4] = 0.8;
    const waterSurface = mesh(buildTerrainMesh(terrain(water, elevation)), 'terrain-water');
    const positions = waterSurface.geometry.getAttribute('position') as BufferAttribute;
    const colors = waterSurface.geometry.getAttribute('color') as BufferAttribute;

    expect(positions.count).toBe(4);
    expect(colors.count).toBe(4);
    const uniqueColors = new Set(
      Array.from({ length: colors.count }, (_, i) =>
        `${colors.getX(i)},${colors.getY(i)},${colors.getZ(i)}`),
    );
    expect(uniqueColors.size).toBe(1);
  });
});
