import { Color, Matrix4, SRGBColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import { RenderWorld } from 'voxel/core';

import { BuildingsView, type BuildingRenderView } from '../../src/rendering/buildings-mesh';
import {
  VOXEL_DETAIL_BATCH_KEY,
  VOXEL_ROOF_BOX_BATCH_KEY,
  VOXEL_ROOF_PYRAMID_BATCH_KEY,
  VOXEL_ROOF_PYRAMID_GEOMETRY_KEY,
  VOXEL_WALLS_BATCH_KEY,
  VOXEL_WALLS_GEOMETRY_KEY,
  VoxelWallsLane,
} from '../../src/rendering/voxel-walls-lane';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from '../../src/rendering/terrain-surface';

function view(overrides: Partial<BuildingRenderView> & { id: number }): BuildingRenderView {
  return {
    x: 3,
    y: 5,
    w: 2,
    h: 2,
    zone: 'R',
    level: 1,
    abandoned: false,
    ...overrides,
  };
}

/** A sloped surface, so the foundation range is never degenerate. */
const SLOPED: TerrainSurfaceView = {
  ...FLAT_TERRAIN_SURFACE,
  heightAt: (x: number, z: number) => (x + z) * 0.05,
  footprintRange: (x: number, y: number, w: number, h: number) => ({
    min: (x + y) * 0.05,
    max: (x + w + y + h) * 0.05,
  }),
};

interface WallMeshReader {
  getMatrixAt(index: number, target: Matrix4): void;
  getColorAt(index: number, target: Color): void;
}

/** The mesh of one BuildingsView layer, for the same building. */
function referenceMesh(
  target: BuildingRenderView,
  surface: TerrainSurfaceView,
  layer: string,
): WallMeshReader {
  const buildings = new BuildingsView();
  buildings.setTerrainSurface(surface);
  buildings.upsert(target);
  const mesh = buildings.group.children.find((child) => child.name === layer);
  if (!mesh || !('getMatrixAt' in mesh)) throw new Error(`Expected the ${layer} mesh.`);
  return mesh as unknown as WallMeshReader;
}

function referenceWallMatrix(
  target: BuildingRenderView,
  surface: TerrainSurfaceView,
): Matrix4 {
  const matrix = new Matrix4();
  referenceMesh(target, surface, `${target.zone}-walls`).getMatrixAt(0, matrix);
  return matrix;
}

/** The working-space colour BuildingsView uploads for the same building. */
function referenceWallColor(target: BuildingRenderView): Color {
  const color = new Color();
  referenceMesh(target, FLAT_TERRAIN_SURFACE, `${target.zone}-walls`).getColorAt(0, color);
  return color;
}

describe('VoxelWallsLane', () => {
  it('writes the matrix BuildingsView writes, for every zone and level', () => {
    for (const zone of ['R', 'C', 'I'] as const) {
      for (const level of [1, 2, 3]) {
        for (const abandoned of [false, true]) {
          const target = view({ id: 41 + level, zone, level, abandoned });
          const lane = new VoxelWallsLane();
          lane.setTerrainSurface(SLOPED);
          lane.upsert(target);
          const batch = lane.snapshot().batches[0]!;
          const actual = new Matrix4().fromArray(batch.matrices, 0);

          // Identical, not merely close: the migration must be invisible.
          expect(actual.elements).toEqual(referenceWallMatrix(target, SLOPED).elements);
        }
      }
    }
  });

  it('writes the roof matrix and colour BuildingsView writes', () => {
    for (const zone of ['R', 'C', 'I'] as const) {
      for (const level of [1, 2, 3]) {
        for (const abandoned of [false, true]) {
          const target = view({ id: 61 + level, zone, level, abandoned });
          const lane = new VoxelWallsLane();
          lane.setTerrainSurface(SLOPED);
          lane.upsert(target);
          const snapshot = lane.snapshot();
          const batchKey = zone === 'R'
            ? VOXEL_ROOF_PYRAMID_BATCH_KEY
            : VOXEL_ROOF_BOX_BATCH_KEY;
          const batch = snapshot.batches.find((candidate) => candidate.key === batchKey)!;

          expect(batch.instanceKeys).toEqual([String(target.id)]);
          const actual = new Matrix4().fromArray(batch.matrices, 0);
          const expected = new Matrix4();
          referenceMesh(target, SLOPED, `${zone}-roofs`).getMatrixAt(0, expected);
          expect(actual.elements).toEqual(expected.elements);

          const decoded = new Color().setRGB(
            batch.colors![0]! / 255,
            batch.colors![1]! / 255,
            batch.colors![2]! / 255,
            SRGBColorSpace,
          );
          const expectedColor = new Color();
          referenceMesh(target, FLAT_TERRAIN_SURFACE, `${zone}-roofs`).getColorAt(0, expectedColor);
          expect(decoded.r).toBeCloseTo(expectedColor.r, 2);
          expect(decoded.g).toBeCloseTo(expectedColor.g, 2);
          expect(decoded.b).toBeCloseTo(expectedColor.b, 2);
        }
      }
    }
  });

  it('writes the rooftop detail matrix and colour BuildingsView writes', () => {
    for (const zone of ['R', 'C', 'I'] as const) {
      for (const abandoned of [false, true]) {
        const target = view({ id: 83, zone, level: 2, abandoned });
        const lane = new VoxelWallsLane();
        lane.setTerrainSurface(SLOPED);
        lane.upsert(target);
        const batch = lane.snapshot().batches.find(
          (candidate) => candidate.key === VOXEL_DETAIL_BATCH_KEY,
        )!;

        const actual = new Matrix4().fromArray(batch.matrices, 0);
        const expected = new Matrix4();
        referenceMesh(target, SLOPED, `${zone}-roof-details`).getMatrixAt(0, expected);
        expect(actual.elements).toEqual(expected.elements);

        const decoded = new Color().setRGB(
          batch.colors![0]! / 255,
          batch.colors![1]! / 255,
          batch.colors![2]! / 255,
          SRGBColorSpace,
        );
        const expectedColor = new Color();
        referenceMesh(target, FLAT_TERRAIN_SURFACE, `${zone}-roof-details`)
          .getColorAt(0, expectedColor);
        expect(decoded.r).toBeCloseTo(expectedColor.r, 2);
        expect(decoded.g).toBeCloseTo(expectedColor.g, 2);
        expect(decoded.b).toBeCloseTo(expectedColor.b, 2);
      }
    }
  });

  it('splits roofs by geometry rather than by zone', () => {
    const lane = new VoxelWallsLane();
    lane.upsert(view({ id: 1, zone: 'R' }));
    lane.upsert(view({ id: 2, zone: 'C' }));
    lane.upsert(view({ id: 3, zone: 'I' }));
    const snapshot = lane.snapshot();

    // Three zones, but only two roof geometries, so two roof batches.
    const pyramid = snapshot.batches.find((b) => b.key === VOXEL_ROOF_PYRAMID_BATCH_KEY)!;
    const box = snapshot.batches.find((b) => b.key === VOXEL_ROOF_BOX_BATCH_KEY)!;
    expect(pyramid.instanceKeys).toEqual(['1']);
    expect(box.instanceKeys).toEqual(['2', '3']);
    expect(pyramid.geometryKey).toBe(VOXEL_ROOF_PYRAMID_GEOMETRY_KEY);
    // Box roofs reuse the wall box rather than duplicating a geometry.
    expect(box.geometryKey).toBe(VOXEL_WALLS_GEOMETRY_KEY);
    expect(snapshot.batches).toHaveLength(4);
  });

  it('keeps the batch keys equal to the live building set through churn', () => {
    const lane = new VoxelWallsLane();
    const buildings = new BuildingsView();
    const apply = (fn: (sink: { upsert(v: BuildingRenderView): void; remove(id: number): void }) => void) => {
      fn(lane);
      fn(buildings);
    };

    apply((sink) => { for (const id of [1, 2, 3, 4]) sink.upsert(view({ id, zone: 'C' })); });
    // Swap-remove a middle element, then reuse the tail id.
    apply((sink) => { sink.remove(2); });
    apply((sink) => { sink.upsert(view({ id: 9, zone: 'I' })); });
    apply((sink) => { sink.remove(4); });
    apply((sink) => { sink.upsert(view({ id: 2, zone: 'R', level: 3 })); });
    // An unknown id must be tolerated, exactly as BuildingsView tolerates it.
    apply((sink) => { sink.remove(777); });

    expect(lane.count).toBe(buildings.count);
    expect(lane.instanceKeysInternal).toEqual(['1', '2', '3', '9']);
    expect(lane.snapshot().batches[0]!.instanceKeys).toEqual(['1', '2', '3', '9']);
  });

  it('writes the colour BuildingsView writes, after Voxel decodes it', () => {
    for (const zone of ['R', 'C', 'I'] as const) {
      for (const level of [1, 2, 3]) {
        for (const abandoned of [false, true]) {
          const target = view({ id: 17 + level, zone, level, abandoned });
          const lane = new VoxelWallsLane();
          lane.upsert(target);
          const colors = lane.snapshot().batches[0]!.colors!;

          // Voxel decodes the byte lane as sRGB and converts to the working
          // colour space; City's setHex already produced working-space floats.
          // Encoding City's floats as bytes without converting would make the
          // walls render darker, so assert the full round trip.
          const decoded = new Color().setRGB(
            colors[0]! / 255,
            colors[1]! / 255,
            colors[2]! / 255,
            SRGBColorSpace,
          );
          const expected = referenceWallColor(target);
          expect(decoded.r).toBeCloseTo(expected.r, 2);
          expect(decoded.g).toBeCloseTo(expected.g, 2);
          expect(decoded.b).toBeCloseTo(expected.b, 2);
        }
      }
    }
  });

  it('collapses all three zones into one wall batch, varying only by colour', () => {
    const lane = new VoxelWallsLane();
    lane.upsert(view({ id: 1, zone: 'R' }));
    lane.upsert(view({ id: 2, zone: 'C' }));
    lane.upsert(view({ id: 3, zone: 'I' }));
    const snapshot = lane.snapshot();

    const walls = snapshot.batches.find((batch) => batch.key === VOXEL_WALLS_BATCH_KEY)!;
    expect(walls.instanceKeys).toEqual(['1', '2', '3']);
    const colors = walls.colors!;
    const rgb = (index: number) => [...colors.slice(index * 4, index * 4 + 3)];
    expect(rgb(0)).not.toEqual(rgb(1));
    expect(rgb(1)).not.toEqual(rgb(2));
    expect([...colors.filter((_, index) => index % 4 === 3)]).toEqual([255, 255, 255]);
  });

  it('declares the material BuildingsView uses, without vertex colours', () => {
    const lane = new VoxelWallsLane();
    lane.upsert(view({ id: 1 }));
    const material = lane.snapshot().resources.find(
      (resource) => resource.kind === 'material',
    );

    // The wall box has no per-vertex colour attribute. Declaring vertexColors
    // would multiply every wall by an unbound attribute and render it black,
    // while per-instance tints ride the batch colour lane regardless.
    expect(material).toMatchObject({
      shading: 'lambert',
      vertexColors: false,
      transparent: false,
      opacity: 1,
      color: { r: 255, g: 255, b: 255, a: 255 },
    });
    const geometry = lane.snapshot().resources.find(
      (resource) => resource.kind === 'geometry',
    );
    expect(geometry).toMatchObject({ topology: 'triangles' });
    expect('colors' in (geometry ?? {})).toBe(false);
  });

  it('opts into City shadows without asking Voxel to own a shadow system', () => {
    const lane = new VoxelWallsLane();
    lane.upsert(view({ id: 1 }));
    expect(lane.snapshot().batches[0]!.presentation).toEqual({
      castShadow: true,
      receiveShadow: true,
    });
  });

  it('re-emits every matrix when the terrain surface changes', () => {
    const lane = new VoxelWallsLane();
    lane.upsert(view({ id: 1 }));
    const flat = lane.snapshot().batches[0]!.matrices.slice();
    lane.setTerrainSurface(SLOPED);
    const sloped = lane.snapshot().batches[0]!.matrices.slice();
    expect([...sloped]).not.toEqual([...flat]);
  });

  it('rebuilds only when the live set moved', () => {
    const lane = new VoxelWallsLane();
    expect(lane.snapshotIfDirty()).toBeNull();

    lane.upsert(view({ id: 1 }));
    expect(lane.snapshotIfDirty()).not.toBeNull();
    // A clean lane must not rebuild every matrix each frame.
    expect(lane.snapshotIfDirty()).toBeNull();

    // Removing an unknown id changes nothing and must not dirty the lane.
    lane.remove(404);
    expect(lane.snapshotIfDirty()).toBeNull();

    lane.remove(1);
    expect(lane.snapshotIfDirty()).not.toBeNull();
    lane.setTerrainSurface(SLOPED);
    expect(lane.snapshotIfDirty()).not.toBeNull();
    expect(lane.snapshotIfDirty()).toBeNull();
  });

  it('produces snapshots Voxel accepts, with a monotonic revision', () => {
    const lane = new VoxelWallsLane();
    const world = new RenderWorld();
    lane.upsert(view({ id: 1, zone: 'R' }));
    lane.upsert(view({ id: 2, zone: 'C', abandoned: true }));

    const first = world.acceptSnapshot(lane.snapshot());
    expect(first.status).toBe('accepted');
    lane.remove(1);
    const second = world.acceptSnapshot(lane.snapshot());
    expect(second).toMatchObject({ status: 'accepted', revision: 2 });
    world.dispose();
  });
});
