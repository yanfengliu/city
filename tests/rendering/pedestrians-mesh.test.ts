import { Color, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { PedestrianPurpose, PedestrianView } from '../../src/protocol/messages';
import {
  PEDESTRIAN_CAPACITY,
  PEDESTRIAN_CURB_OFFSET,
  PEDESTRIAN_PURPOSE_COLORS,
  PEDESTRIAN_Y,
} from '../../src/rendering/constants';
import { PedestriansView } from '../../src/rendering/pedestrians-mesh';
import { MAX_PEDESTRIANS } from '../../src/sim/constants/traffic';
import type { TerrainSurfaceView } from '../../src/rendering/terrain-surface';

const pedestrian = (
  overrides: Partial<PedestrianView> = {},
): PedestrianView => ({
  id: 1,
  generation: 0,
  fromCell: 0,
  toCell: 1,
  t: 0.5,
  purpose: 'commercial-work',
  outbound: true,
  ...overrides,
});

const poseAt = (
  view: PedestriansView,
  slot = 0,
): { x: number; y: number; z: number; yaw: number } => {
  const matrix = new Matrix4();
  view.bodyMesh.getMatrixAt(slot, matrix);
  const position = new Vector3().setFromMatrixPosition(matrix);
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    yaw: Math.atan2(matrix.elements[8], matrix.elements[0]),
  };
};

const purposeColorAt = (view: PedestriansView, slot: number): number => {
  const color = new Color();
  view.bodyMesh.getColorAt(slot, color);
  return color.getHex();
};

const flatRaisedSurface = (height: number): TerrainSurfaceView => ({
  width: 10,
  height: 10,
  minHeight: height,
  maxHeight: height,
  cellHeight: () => height,
  cornerHeight: () => height,
  heightAt: () => height,
  groundHeightAt: () => height,
  footprintRange: () => ({ min: height, max: height }),
});

describe('PedestriansView', () => {
  it('can present the full simulation pedestrian cap', () => {
    expect(PEDESTRIAN_CAPACITY).toBeGreaterThanOrEqual(MAX_PEDESTRIANS);
  });

  it('uses two non-shadow instanced batches with one shared transform buffer', () => {
    const view = new PedestriansView(10);

    expect(view.group.name).toBe('pedestrians');
    expect(view.group.children).toEqual([view.bodyMesh, view.headMesh]);
    expect(view.bodyMesh.name).toBe('pedestrian-bodies');
    expect(view.headMesh.name).toBe('pedestrian-heads');
    expect(view.bodyMesh.instanceMatrix.count).toBe(PEDESTRIAN_CAPACITY);
    expect(view.headMesh.instanceMatrix).toBe(view.bodyMesh.instanceMatrix);
    expect(view.bodyMesh.castShadow).toBe(false);
    expect(view.bodyMesh.receiveShadow).toBe(false);
    expect(view.headMesh.castShadow).toBe(false);
    expect(view.headMesh.receiveShadow).toBe(false);
    expect(view.bodyMesh.frustumCulled).toBe(false);
    expect(view.headMesh.frustumCulled).toBe(false);
    expect(view.count).toBe(0);
  });

  it('samples a road segment and moves to the direction-dependent curb', () => {
    const forward = new PedestriansView(10, () => 100);
    forward.setPedestrians([pedestrian()]);
    const forwardPose = poseAt(forward);
    expect(forwardPose.x).toBeCloseTo(1, 5);
    expect(forwardPose.y).toBeCloseTo(PEDESTRIAN_Y, 5);
    expect(forwardPose.z).toBeCloseTo(0.5 - PEDESTRIAN_CURB_OFFSET, 5);
    expect(forwardPose.yaw).toBeCloseTo(Math.PI / 2, 5);

    const reverse = new PedestriansView(10, () => 100);
    reverse.setPedestrians([pedestrian({ fromCell: 1, toCell: 0 })]);
    const reversePose = poseAt(reverse);
    expect(reversePose.x).toBeCloseTo(1, 5);
    expect(reversePose.z).toBeCloseTo(0.5 + PEDESTRIAN_CURB_OFFSET, 5);
    expect(reversePose.yaw).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('samples the terrain under the curb-offset world position', () => {
    const view = new PedestriansView(10, () => 100);
    view.setTerrainSurface(flatRaisedSurface(0.72));
    view.setPedestrians([pedestrian()]);

    expect(poseAt(view).y).toBeCloseTo(0.72 + PEDESTRIAN_Y, 5);
  });

  it('retargets an early turn from the currently presented pose', () => {
    let now = 100;
    const view = new PedestriansView(10, () => now);
    view.setPedestrians([pedestrian()]);

    now = 200;
    view.setPedestrians([pedestrian({ t: 0.9 })]);
    now = 250;
    view.updateFrame(now);
    const beforeTurn = poseAt(view);
    expect(beforeTurn.x).toBeCloseTo(1.2, 5);
    expect(beforeTurn.z).toBeCloseTo(0.5 - PEDESTRIAN_CURB_OFFSET, 5);
    expect(beforeTurn.yaw).toBeCloseTo(Math.PI / 2, 5);

    view.setPedestrians([pedestrian({ fromCell: 1, toCell: 11 })]);
    const afterMessage = poseAt(view);
    expect(afterMessage.x).toBeCloseTo(beforeTurn.x, 5);
    expect(afterMessage.z).toBeCloseTo(beforeTurn.z, 5);
    expect(afterMessage.yaw).toBeCloseTo(beforeTurn.yaw, 5);

    now = 275;
    view.updateFrame(now);
    const halfway = poseAt(view);
    expect(halfway.x).toBeCloseTo((beforeTurn.x + 1.5 + PEDESTRIAN_CURB_OFFSET) / 2, 5);
    expect(halfway.z).toBeCloseTo((beforeTurn.z + 1) / 2, 5);
    expect(halfway.yaw).toBeCloseTo(Math.PI / 4, 5);
  });

  it('snaps a recycled id to the replacement generation pose', () => {
    let now = 100;
    const view = new PedestriansView(10, () => now);
    view.setPedestrians([pedestrian({ id: 7, generation: 3 })]);

    now = 200;
    view.setPedestrians([pedestrian({ id: 7, generation: 3, t: 0.9 })]);
    now = 250;
    view.updateFrame(now);
    expect(poseAt(view).x).toBeCloseTo(1.2, 5);

    view.setPedestrians([
      pedestrian({ id: 7, generation: 4, fromCell: 1, toCell: 11 }),
    ]);
    const replacement = poseAt(view);
    expect(replacement.x).toBeCloseTo(1.5 + PEDESTRIAN_CURB_OFFSET, 5);
    expect(replacement.z).toBeCloseTo(1, 5);
    expect(replacement.yaw).toBeCloseTo(0, 5);
  });

  it('clears both batches and interpolation history for an empty full-list update', () => {
    let now = 100;
    const view = new PedestriansView(10, () => now);
    view.setPedestrians([pedestrian({ id: 7 })]);

    now = 200;
    view.setPedestrians([]);
    expect(view.count).toBe(0);
    expect(view.bodyMesh.count).toBe(0);
    expect(view.headMesh.count).toBe(0);

    now = 300;
    view.setPedestrians([
      pedestrian({ id: 7, fromCell: 1, toCell: 11 }),
    ]);
    const returned = poseAt(view);
    expect(returned.x).toBeCloseTo(1.5 + PEDESTRIAN_CURB_OFFSET, 5);
    expect(returned.z).toBeCloseTo(1, 5);
    expect(returned.yaw).toBeCloseTo(0, 5);
  });

  it('caps live instances and colors bodies by trip purpose', () => {
    const purposes: PedestrianPurpose[] = [
      'commercial-work',
      'industrial-work',
      'shopping',
    ];
    const view = new PedestriansView(10, () => 100);
    const list = Array.from({ length: PEDESTRIAN_CAPACITY + 4 }, (_, id) =>
      pedestrian({ id, purpose: purposes[id % purposes.length] }),
    );

    view.setPedestrians(list);

    expect(view.count).toBe(PEDESTRIAN_CAPACITY);
    expect(view.bodyMesh.count).toBe(PEDESTRIAN_CAPACITY);
    expect(view.headMesh.count).toBe(PEDESTRIAN_CAPACITY);
    for (let slot = 0; slot < purposes.length; slot++) {
      expect(purposeColorAt(view, slot)).toBe(
        PEDESTRIAN_PURPOSE_COLORS[purposes[slot]],
      );
    }
  });
});
