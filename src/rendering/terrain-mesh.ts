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
  LAND_ELEVATION_LIGHTNESS_RANGE,
  LAND_LIGHTNESS_JITTER,
  SHORE_COLOR,
  SHORE_DETAIL_COLOR,
  SHORE_DETAIL_INSET,
  SHORE_DETAIL_LIGHTNESS_JITTER,
  SHORE_DETAIL_Y,
  WATER_COLOR,
  WATER_SURFACE_Y,
} from './constants';
import { buildSurfacePatch, type SurfacePatch } from './surface-geometry';
import { TerrainSurface, type TerrainSurfaceView } from './terrain-surface';

/** Plain-data view of the generated terrain (mirrors protocol TerrainPayload). */
export interface TerrainMeshData {
  width: number;
  height: number;
  elevation: Float32Array;
  seaLevel: number;
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

  surfacePatch(patch: SurfacePatch, color: Color): void {
    const base = this.positions.length / 3;
    this.positions.push(...patch.positions);
    const count = patch.positions.length / 3;
    for (let i = 0; i < count; i++) {
      this.normals.push(0, 1, 0);
      this.colors.push(color.r, color.g, color.b);
    }
    for (const index of patch.indices) this.indices.push(base + index);
  }

  build(vertexColors: boolean): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    if (vertexColors) {
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    }
    geometry.setIndex(new BufferAttribute(new Uint32Array(this.indices), 1));
    geometry.computeVertexNormals();
    return geometry;
  }
}

/**
 * Builds the static terrain as three merged meshes under one group: land +
 * vertical shore skirts, sandy shoreline top strips, and the recessed water
 * surface. Land follows the shared elevation field with subtle per-cell
 * lightness jitter; water stays at WATER_SURFACE_Y; vertical shore skirts close
 * the gap where land meets water or the map edge; sandy top strips soften real
 * land-water transitions without touching the sim terrain mask.
 */
export function buildTerrainMesh(
  terrain: TerrainMeshData,
  surface: TerrainSurfaceView = new TerrainSurface(terrain),
): Object3D {
  const { width, height, water } = terrain;
  const land = new MeshBuilder();
  const shoreDetails = new MeshBuilder();
  const waterMesh = new MeshBuilder();

  const landColor = new Color(LAND_COLOR);
  const shoreColor = new Color(SHORE_COLOR);
  const shoreDetailColor = new Color(SHORE_DETAIL_COLOR);
  const cellColor = new Color();
  const detailColor = new Color();

  const isWaterAt = (x: number, z: number): boolean =>
    x < 0 || z < 0 || x >= width || z >= height || water[z * width + x] === 1;
  const isWaterCellAt = (x: number, z: number): boolean =>
    x >= 0 && z >= 0 && x < width && z < height && water[z * width + x] === 1;

  const addShoreDetail = (
    index: number,
    salt: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
  ): void => {
    const jitter = (cellHash01(index + salt) - 0.5) * 2 * SHORE_DETAIL_LIGHTNESS_JITTER;
    detailColor.copy(shoreDetailColor).offsetHSL(0, 0, jitter);
    shoreDetails.surfacePatch(
      buildSurfacePatch(surface, x0, z0, x1, z1, SHORE_DETAIL_Y),
      detailColor,
    );
  };

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
      const heightTint =
        (surface.cellHeight(x, z) / Math.max(surface.maxHeight, Number.EPSILON) - 0.5) *
        LAND_ELEVATION_LIGHTNESS_RANGE;
      cellColor.copy(landColor).offsetHSL(0, 0, jitter + heightTint);
      const h00 = surface.cornerHeight(x, z);
      const h10 = surface.cornerHeight(x + 1, z);
      const h01 = surface.cornerHeight(x, z + 1);
      const h11 = surface.cornerHeight(x + 1, z + 1);
      land.quad([
        [x, h00, z],
        [x + 1, h10, z],
        [x, h01, z + 1],
        [x + 1, h11, z + 1],
      ], [0, 1, 0], cellColor);

      // Shore skirts on land edges exposed to water or the map boundary.
      const w = WATER_SURFACE_Y;
      const northSkirt = isWaterAt(x, z - 1);
      const southSkirt = isWaterAt(x, z + 1);
      const westSkirt = isWaterAt(x - 1, z);
      const eastSkirt = isWaterAt(x + 1, z);
      const northWater = isWaterCellAt(x, z - 1);
      const southWater = isWaterCellAt(x, z + 1);
      const westWater = isWaterCellAt(x - 1, z);
      const eastWater = isWaterCellAt(x + 1, z);

      if (northSkirt) {
        land.quad([[x, h00, z], [x, w, z], [x + 1, h10, z], [x + 1, w, z]], [0, 0, -1], shoreColor);
      }
      if (northWater) {
        const x0 = x + (westWater ? SHORE_DETAIL_INSET : 0);
        const x1 = x + 1 - (eastWater ? SHORE_DETAIL_INSET : 0);
        addShoreDetail(index, 0x1515, x0, z, x1, z + SHORE_DETAIL_INSET);
      }
      if (southSkirt) {
        land.quad([[x, h01, z + 1], [x + 1, h11, z + 1], [x, w, z + 1], [x + 1, w, z + 1]], [0, 0, 1], shoreColor);
      }
      if (southWater) {
        const x0 = x + (westWater ? SHORE_DETAIL_INSET : 0);
        const x1 = x + 1 - (eastWater ? SHORE_DETAIL_INSET : 0);
        addShoreDetail(index, 0x2525, x0, z + 1 - SHORE_DETAIL_INSET, x1, z + 1);
      }
      if (westSkirt) {
        land.quad([[x, h00, z], [x, h01, z + 1], [x, w, z], [x, w, z + 1]], [-1, 0, 0], shoreColor);
      }
      if (westWater) {
        const z0 = z + (northWater ? SHORE_DETAIL_INSET : 0);
        const z1 = z + 1 - (southWater ? SHORE_DETAIL_INSET : 0);
        addShoreDetail(index, 0x3535, x, z0, x + SHORE_DETAIL_INSET, z1);
      }
      if (eastSkirt) {
        land.quad([[x + 1, h10, z], [x + 1, w, z], [x + 1, h11, z + 1], [x + 1, w, z + 1]], [1, 0, 0], shoreColor);
      }
      if (eastWater) {
        const z0 = z + (northWater ? SHORE_DETAIL_INSET : 0);
        const z1 = z + 1 - (southWater ? SHORE_DETAIL_INSET : 0);
        addShoreDetail(index, 0x4545, x + 1 - SHORE_DETAIL_INSET, z0, x + 1, z1);
      }
    }
  }

  const group = new Group();
  group.name = 'terrain';

  const landMesh = new Mesh(
    land.build(true),
    new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
  );
  landMesh.name = 'terrain-land';
  landMesh.receiveShadow = true;
  group.add(landMesh);

  const shoreDetailMesh = new Mesh(
    shoreDetails.build(true),
    new MeshLambertMaterial({
      vertexColors: true,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  shoreDetailMesh.name = 'terrain-shore-details';
  shoreDetailMesh.receiveShadow = true;
  group.add(shoreDetailMesh);

  const water3d = new Mesh(
    waterMesh.build(false),
    new MeshStandardMaterial({ color: WATER_COLOR, roughness: 0.28, metalness: 0.0 }),
  );
  water3d.name = 'terrain-water';
  water3d.receiveShadow = true;
  group.add(water3d);

  return group;
}
