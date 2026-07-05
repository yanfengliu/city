import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
} from 'three';
import type { Object3D } from 'three';
import {
  cellHash01,
  LAND_COLOR,
  LAND_LIGHTNESS_JITTER,
  SHORE_COLOR,
  WATER_COLOR,
  WATER_SURFACE_Y,
} from './constants';

/** Plain-data view of the generated terrain (mirrors protocol TerrainPayload). */
export interface TerrainMeshData {
  width: number;
  height: number;
  /** 1 = water, per cell index (index = y * width + x). */
  water: Uint8Array;
}

type Corner = [number, number, number];

/** Accumulates positions/normals/indices (+ optional vertex colors) for one mesh. */
class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  quad(corners: [Corner, Corner, Corner, Corner], normal: Corner, color?: Color): void {
    const base = this.positions.length / 3;
    for (const corner of corners) {
      this.positions.push(corner[0], corner[1], corner[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      if (color) this.colors.push(color.r, color.g, color.b);
    }
    this.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  build(vertexColors: boolean): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    if (vertexColors) {
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    }
    geometry.setIndex(new BufferAttribute(new Uint32Array(this.indices), 1));
    return geometry;
  }
}

/**
 * Builds the static terrain as two merged meshes under one group: land + shore
 * skirts as a vertex-colored Lambert mesh (shadow receiver), and the recessed
 * water surface as its own low-roughness Standard mesh so the sun leaves a
 * specular sheen instead of the old flat blue. Land sits at y=0 with subtle
 * per-cell lightness jitter; water at WATER_SURFACE_Y; vertical shore skirts
 * close the gap where land meets water or the map edge.
 */
export function buildTerrainMesh(terrain: TerrainMeshData): Object3D {
  const { width, height, water } = terrain;
  const land = new MeshBuilder();
  const waterMesh = new MeshBuilder();

  const landColor = new Color(LAND_COLOR);
  const shoreColor = new Color(SHORE_COLOR);
  const cellColor = new Color();

  const isWaterAt = (x: number, z: number): boolean =>
    x < 0 || z < 0 || x >= width || z >= height || water[z * width + x] === 1;

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const index = z * width + x;
      if (water[index] === 1) {
        const y = WATER_SURFACE_Y;
        waterMesh.quad([
          [x, y, z],
          [x + 1, y, z],
          [x, y, z + 1],
          [x + 1, y, z + 1],
        ], [0, 1, 0]);
        continue;
      }

      const jitter = (cellHash01(index) - 0.5) * 2 * LAND_LIGHTNESS_JITTER;
      cellColor.copy(landColor).offsetHSL(0, 0, jitter);
      land.quad([
        [x, 0, z],
        [x + 1, 0, z],
        [x, 0, z + 1],
        [x + 1, 0, z + 1],
      ], [0, 1, 0], cellColor);

      // Shore skirts on land edges exposed to water or the map boundary.
      const w = WATER_SURFACE_Y;
      if (isWaterAt(x, z - 1)) {
        land.quad([[x, 0, z], [x, w, z], [x + 1, 0, z], [x + 1, w, z]], [0, 0, -1], shoreColor);
      }
      if (isWaterAt(x, z + 1)) {
        land.quad([[x, 0, z + 1], [x + 1, 0, z + 1], [x, w, z + 1], [x + 1, w, z + 1]], [0, 0, 1], shoreColor);
      }
      if (isWaterAt(x - 1, z)) {
        land.quad([[x, 0, z], [x, 0, z + 1], [x, w, z], [x, w, z + 1]], [-1, 0, 0], shoreColor);
      }
      if (isWaterAt(x + 1, z)) {
        land.quad([[x + 1, 0, z], [x + 1, w, z], [x + 1, 0, z + 1], [x + 1, w, z + 1]], [1, 0, 0], shoreColor);
      }
    }
  }

  const group = new Group();
  group.name = 'terrain';

  const landMesh = new Mesh(
    land.build(true),
    new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
  );
  landMesh.receiveShadow = true;
  group.add(landMesh);

  const water3d = new Mesh(
    waterMesh.build(false),
    new MeshStandardMaterial({ color: WATER_COLOR, roughness: 0.28, metalness: 0.0 }),
  );
  water3d.receiveShadow = true;
  group.add(water3d);

  return group;
}
