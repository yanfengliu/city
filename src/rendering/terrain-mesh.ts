import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshLambertMaterial,
} from 'three';
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

/**
 * Builds the static terrain as one merged vertex-colored BufferGeometry: a
 * flat quad per cell (land at y=0 with subtle per-cell lightness jitter, water
 * recessed at WATER_SURFACE_Y) plus vertical shore skirts where land meets
 * water or the map edge, so the recessed water never shows a gap.
 */
export function buildTerrainMesh(terrain: TerrainMeshData): Mesh {
  const { width, height, water } = terrain;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const landColor = new Color(LAND_COLOR);
  const waterColor = new Color(WATER_COLOR);
  const shoreColor = new Color(SHORE_COLOR);
  const cellColor = new Color();

  const pushQuad = (corners: [Corner, Corner, Corner, Corner], normal: Corner, color: Color): void => {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(normal[0], normal[1], normal[2]);
      colors.push(color.r, color.g, color.b);
    }
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };

  const isWaterAt = (x: number, z: number): boolean =>
    x < 0 || z < 0 || x >= width || z >= height || water[z * width + x] === 1;

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const index = z * width + x;
      const isWater = water[index] === 1;
      const y = isWater ? WATER_SURFACE_Y : 0;
      if (isWater) {
        cellColor.copy(waterColor);
      } else {
        const jitter = (cellHash01(index) - 0.5) * 2 * LAND_LIGHTNESS_JITTER;
        cellColor.copy(landColor).offsetHSL(0, 0, jitter);
      }
      pushQuad(
        [
          [x, y, z],
          [x + 1, y, z],
          [x, y, z + 1],
          [x + 1, y, z + 1],
        ],
        [0, 1, 0],
        cellColor,
      );
      if (isWater) continue;

      // Shore skirts on land edges exposed to water or the map boundary.
      const w = WATER_SURFACE_Y;
      if (isWaterAt(x, z - 1)) {
        pushQuad([[x, 0, z], [x, w, z], [x + 1, 0, z], [x + 1, w, z]], [0, 0, -1], shoreColor);
      }
      if (isWaterAt(x, z + 1)) {
        pushQuad([[x, 0, z + 1], [x + 1, 0, z + 1], [x, w, z + 1], [x + 1, w, z + 1]], [0, 0, 1], shoreColor);
      }
      if (isWaterAt(x - 1, z)) {
        pushQuad([[x, 0, z], [x, 0, z + 1], [x, w, z], [x, w, z + 1]], [-1, 0, 0], shoreColor);
      }
      if (isWaterAt(x + 1, z)) {
        pushQuad([[x + 1, 0, z], [x + 1, w, z], [x + 1, 0, z + 1], [x + 1, w, z + 1]], [1, 0, 0], shoreColor);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));

  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'terrain';
  return mesh;
}
