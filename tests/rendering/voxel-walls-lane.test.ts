import { Color, Matrix4, SRGBColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import { RenderWorld } from 'voxel/core';

import { BuildingsView, type BuildingRenderView } from '../../src/rendering/buildings-mesh';
import {
  VOXEL_WALLS_BATCH_KEY,
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

/** The wall mesh BuildingsView itself wrote, for the same building. */
function referenceWallMesh(
  target: BuildingRenderView,
  surface: TerrainSurfaceView,
): WallMeshReader {
  const buildings = new BuildingsView();
  buildings.setTerrainSurface(surface);
  buildings.upsert(target);
  const walls = buildings.group.children.find(
    (child) => child.name === `${target.zone}-walls`,
  );
  if (!walls || !('getMatrixAt' in walls)) throw new Error('Expected a walls mesh.');
  return walls as unknown as WallMeshReader;
}

function referenceWallMatrix(
  target: BuildingRenderView,
  surface: TerrainSurfaceView,
): Matrix4 {
  const matrix = new Matrix4();
  referenceWallMesh(target, surface).getMatrixAt(0, matrix);
  return matrix;
}

/** The working-space colour BuildingsView uploads for the same building. */
function referenceWallColor(target: BuildingRenderView): Color {
  const color = new Color();
  referenceWallMesh(target, FLAT_TERRAIN_SURFACE).getColorAt(0, color);
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

  it('collapses all three zones into one batch, varying only by colour', () => {
    const lane = new VoxelWallsLane();
    lane.upsert(view({ id: 1, zone: 'R' }));
    lane.upsert(view({ id: 2, zone: 'C' }));
    lane.upsert(view({ id: 3, zone: 'I' }));
    const snapshot = lane.snapshot();

    expect(snapshot.batches).toHaveLength(1);
    expect(snapshot.batches[0]!.key).toBe(VOXEL_WALLS_BATCH_KEY);
    const colors = snapshot.batches[0]!.colors!;
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
