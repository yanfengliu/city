import { BoxGeometry, Color, Matrix4 } from 'three';
import type {
  GeometryResourceV1,
  InstanceBatchV1,
  MaterialResourceV1,
  RenderSnapshotV1,
} from 'voxel/core';

import {
  BUILDING_ABANDONED_WALL_COLOR,
  BUILDING_FOOTPRINT_JITTER,
  BUILDING_FOOTPRINT_MARGIN,
  BUILDING_HEIGHT_JITTER,
  BUILDING_LEVEL_HEIGHTS,
  BUILDING_LEVEL_WALL_LIGHTEN,
  BUILDING_TINT_HUE_JITTER,
  BUILDING_TINT_LIGHT_JITTER,
  BUILDING_WALL_COLORS,
  cellHash01,
} from './constants';
import type { BuildingRenderView } from './buildings-mesh';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

export const VOXEL_WALLS_WORLD_ID = 'world:city';
export const VOXEL_WALLS_EPOCH = 'epoch:city-walls/1';
export const VOXEL_WALLS_GEOMETRY_KEY = 'geometry:building-wall-unit-box';
export const VOXEL_WALLS_MATERIAL_KEY = 'material:building-wall';
export const VOXEL_WALLS_BATCH_KEY = 'batch:building-walls';

const MATRIX = new Matrix4();
const COLOR = new Color();

/**
 * The unit box BuildingsView uses for wall bodies, expressed as a Voxel
 * geometry resource. Base at y=0, so an instance matrix scales it to
 * footprint and height directly.
 */
function unitBoxGeometry(): GeometryResourceV1 {
  const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const position = box.getAttribute('position');
  const normal = box.getAttribute('normal');
  const index = box.getIndex();
  if (!index) throw new Error('Wall unit box geometry must be indexed.');
  const resource: GeometryResourceV1 = {
    kind: 'geometry',
    key: VOXEL_WALLS_GEOMETRY_KEY,
    incarnation: 1,
    revision: 1,
    topology: 'triangles',
    positions: new Float32Array(position.array),
    normals: new Float32Array(normal.array),
    indices: new Uint16Array(index.array),
    groups: [],
    bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } },
    pivot: { x: 0, y: 0, z: 0 },
  };
  box.dispose();
  return resource;
}

/** Mirrors BuildingsView's shared opaque Lambert material. */
function wallMaterial(): MaterialResourceV1 {
  return {
    kind: 'material',
    key: VOXEL_WALLS_MATERIAL_KEY,
    incarnation: 1,
    revision: 1,
    shading: 'lambert',
    color: { r: 255, g: 255, b: 255, a: 255 },
    vertexColors: true,
    transparent: false,
    opacity: 1,
    doubleSided: false,
    roughness: 1,
    metalness: 0,
  };
}

/**
 * The wall body transform for one building. This is BuildingsView's own
 * `writeInstance` wall math, and must stay identical to it: independent
 * per-axis footprint shrink, level height with per-building jitter, and a
 * foundation that sinks the body to the lowest covered terrain height.
 */
export function wallMatrixInto(
  view: BuildingRenderView,
  surface: TerrainSurfaceView,
  target: Matrix4,
): Matrix4 {
  const levelIndex = Math.min(Math.max(view.level, 1), BUILDING_LEVEL_HEIGHTS.length) - 1;
  const jitter = 1 + (cellHash01(view.id) - 0.5) * BUILDING_HEIGHT_JITTER;
  const height = BUILDING_LEVEL_HEIGHTS[levelIndex]! * jitter;
  const cx = view.x + view.w / 2;
  const cz = view.y + view.h / 2;
  const foundation = surface.footprintRange(view.x, view.y, view.w, view.h);
  const foundationDepth = foundation.max - foundation.min;
  const sx = view.w * (BUILDING_FOOTPRINT_MARGIN - cellHash01(view.id + 0x1111) * BUILDING_FOOTPRINT_JITTER);
  const sz = view.h * (BUILDING_FOOTPRINT_MARGIN - cellHash01(view.id + 0x2222) * BUILDING_FOOTPRINT_JITTER);
  return target
    .makeScale(sx, height + foundationDepth, sz)
    .setPosition(cx, foundation.min, cz);
}

/** BuildingsView's wall tint, including the abandoned decay jitter. */
export function wallColorInto(view: BuildingRenderView, target: Color): Color {
  if (view.abandoned) {
    const decayJit = (cellHash01(view.id + 0x5555) - 0.5) * BUILDING_TINT_LIGHT_JITTER * 1.5;
    return target.setHex(BUILDING_ABANDONED_WALL_COLOR).offsetHSL(0, 0, decayJit);
  }
  const levelIndex = Math.min(Math.max(view.level, 1), BUILDING_LEVEL_HEIGHTS.length) - 1;
  const hueJit = (cellHash01(view.id + 0x3333) - 0.5) * BUILDING_TINT_HUE_JITTER;
  const lightJit = (cellHash01(view.id + 0x4444) - 0.5) * BUILDING_TINT_LIGHT_JITTER;
  target.setHex(BUILDING_WALL_COLORS[view.zone]);
  return target.offsetHSL(hueJit, 0, BUILDING_LEVEL_WALL_LIGHTEN * levelIndex + lightJit);
}

function srgb8(channel: number): number {
  return Math.max(0, Math.min(255, Math.round(channel * 255)));
}

/**
 * Translates City's live building set into Voxel's wall batch.
 *
 * All three zone archetypes collapse into one keyed batch: walls share the
 * unit box and the shared Lambert material, and the zone only reaches the
 * renderer as a per-instance colour. Instance keys are the building id, so
 * Voxel owns slot mapping and City's remaining layers keep their own
 * swap-remove independently.
 */
export class VoxelWallsLane {
  private readonly views = new Map<number, BuildingRenderView>();
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
  private revision = 0;

  get count(): number {
    return this.views.size;
  }

  /** The exact live building ids, in the batch's deterministic order. */
  get instanceKeysInternal(): readonly string[] {
    return this.sortedViews().map((view) => String(view.id));
  }

  upsert(view: BuildingRenderView): void {
    this.views.set(view.id, view);
  }

  /** Tolerates unknown ids, matching BuildingsView's defensive removal. */
  remove(id: number): void {
    this.views.delete(id);
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
  }

  /**
   * Builds the next whole-world snapshot. Voxel copies every typed array it
   * retains, so the buffers built here are never aliased by the renderer.
   */
  snapshot(): RenderSnapshotV1 {
    this.revision += 1;
    const views = this.sortedViews();
    const matrices = new Float32Array(views.length * 16);
    const colors = new Uint8Array(views.length * 4);
    const instanceKeys: string[] = [];
    for (let index = 0; index < views.length; index += 1) {
      const view = views[index]!;
      instanceKeys.push(String(view.id));
      wallMatrixInto(view, this.surface, MATRIX);
      matrices.set(MATRIX.elements, index * 16);
      wallColorInto(view, COLOR);
      colors.set(
        [srgb8(COLOR.r), srgb8(COLOR.g), srgb8(COLOR.b), 255],
        index * 4,
      );
    }
    const batch: InstanceBatchV1 = {
      key: VOXEL_WALLS_BATCH_KEY,
      incarnation: 1,
      revision: this.revision,
      geometryKey: VOXEL_WALLS_GEOMETRY_KEY,
      materialKey: VOXEL_WALLS_MATERIAL_KEY,
      instanceKeys,
      matrices,
      colors,
      // City keeps shadow-map policy; these are neutral opt-in flags matching
      // the wall meshes they replace.
      presentation: { castShadow: true, receiveShadow: true },
    };
    return {
      schemaVersion: 'voxel.render-snapshot/1',
      descriptor: {
        schemaVersion: 'voxel.world/1',
        worldId: VOXEL_WALLS_WORLD_ID,
        epoch: VOXEL_WALLS_EPOCH,
        coordinates: {
          handedness: 'right',
          upAxis: '+y',
          forwardAxis: '-z',
          chunkRounding: 'floor',
          metersPerWorldUnit: 1,
          worldUnitsPerVoxel: { x: 1, y: 1, z: 1 },
        },
        colorEncoding: 'srgb8-straight-alpha',
        capabilities: ['instance-batches', 'geometry-resources'],
        limits: {
          // Voxel requires every limit to be at least one, so the unused voxel
          // lanes declare a floor rather than zero. This lane ships no chunks.
          maxResources: 8,
          maxPaletteEntries: 1,
          maxChunks: 1,
          maxBatches: 1,
          maxVoxelsPerChunk: 1,
          maxGeometryVertices: 4_096,
          maxGeometryIndices: 12_288,
          maxInstancesPerBatch: 200_000,
          maxTotalBytes: 64_000_000,
        },
      },
      revision: this.revision,
      resources: [unitBoxGeometry(), wallMaterial()],
      chunks: [],
      batches: [batch],
    };
  }

  private sortedViews(): readonly BuildingRenderView[] {
    return [...this.views.values()].sort((left, right) => left.id - right.id);
  }
}
