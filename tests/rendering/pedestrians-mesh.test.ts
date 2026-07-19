import { Color, Matrix4, Vector3 } from 'three';
import type { BufferGeometry, InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import type { PedestrianPurpose, PedestrianView } from '../../src/protocol/messages';
import {
  PEDESTRIAN_ARM,
  PEDESTRIAN_BODY,
  PEDESTRIAN_CAPACITY,
  PEDESTRIAN_CURB_OFFSET,
  PEDESTRIAN_LEG,
} from '../../src/rendering/constants';
import { pedestrianGait } from '../../src/rendering/pedestrian-gait';
import { PedestriansView } from '../../src/rendering/pedestrians-mesh';
import {
  PEDESTRIAN_MAX_HALF_WIDTH,
  PEDESTRIAN_MAX_WIDTH_SCALE,
  PEDESTRIAN_PURPOSE_TOP_PALETTES,
  PEDESTRIAN_Y,
  pedestrianStyle,
} from '../../src/rendering/pedestrian-style';
import {
  TRAFFIC_SIGNAL_CORNER_INSET,
  TRAFFIC_SIGNAL_POLE_HALF_WIDTH,
} from '../../src/rendering/road-streetscape-style';
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

const batches = (view: PedestriansView): InstancedMesh[] => [
  view.topMesh,
  view.bottomMesh,
  view.headMesh,
  view.legLeftMesh,
  view.legRightMesh,
  view.armLeftMesh,
  view.armRightMesh,
];

const matrixOf = (mesh: InstancedMesh, slot: number): Matrix4 => {
  const matrix = new Matrix4();
  mesh.getMatrixAt(slot, matrix);
  return matrix;
};

/** World position of a hanging limb's free end (foot or hand). */
const tipOf = (mesh: InstancedMesh, slot: number, length: number): Vector3 =>
  new Vector3(0, -length, 0).applyMatrix4(matrixOf(mesh, slot));

const footOf = (view: PedestriansView, side: 'left' | 'right', slot = 0): Vector3 =>
  tipOf(side === 'left' ? view.legLeftMesh : view.legRightMesh, slot, PEDESTRIAN_LEG.length);

const handOf = (view: PedestriansView, side: 'left' | 'right', slot = 0): Vector3 =>
  tipOf(side === 'left' ? view.armLeftMesh : view.armRightMesh, slot, PEDESTRIAN_ARM.length);

/**
 * Ground pose of one walker. The shared body matrix pivots at the hip, which is
 * a pure local +y offset, so its x/z are still the walker's ground position;
 * yaw comes off the local X axis, which the torso pitch cannot touch; and the
 * standing height is read from where a foot actually lands.
 */
const poseAt = (
  view: PedestriansView,
  slot = 0,
): { x: number; y: number; z: number; yaw: number } => {
  const matrix = matrixOf(view.topMesh, slot);
  const position = new Vector3().setFromMatrixPosition(matrix);
  return {
    x: position.x,
    y: footOf(view, 'left', slot).y,
    z: position.z,
    yaw: Math.atan2(-matrix.elements[2], matrix.elements[0]),
  };
};

/** How far the feet are split along the walker's own heading — its stride. */
const strideOf = (view: PedestriansView, slot = 0): number => {
  const { yaw } = poseAt(view, slot);
  const left = footOf(view, 'left', slot);
  const right = footOf(view, 'right', slot);
  return (left.x - right.x) * Math.sin(yaw) + (left.z - right.z) * Math.cos(yaw);
};

/** Every instance transform of one walker, for byte-identical comparisons. */
const snapshotOf = (view: PedestriansView, slot = 0): number[] =>
  batches(view).flatMap((mesh) => [...matrixOf(mesh, slot).elements]);

const colorAt = (mesh: InstancedMesh, slot: number): number => {
  const color = new Color();
  mesh.getColorAt(slot, color);
  return color.getHex();
};

const axisValues = (geometry: BufferGeometry, axis: 0 | 1 | 2): number[] => {
  const position = geometry.getAttribute('position').array as Float32Array;
  return Array.from({ length: position.length / 3 }, (_, i) => position[i * 3 + axis]);
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

/** One sim message window; the renderer clamps its lerp to this by default. */
const MESSAGE_MS = 50;

/**
 * Drives one walker along a whole road cell, one message per step, sampling the
 * pose once each message window has fully elapsed. A cell of travel is longer
 * than a stride, so the samples span a complete walk cycle.
 */
const walkOneCell = (
  view: PedestriansView,
  clock: { now: number },
  overrides: Partial<PedestrianView>,
  sample: () => void,
  steps = 20,
): void => {
  for (let step = 0; step < steps; step++) {
    view.setPedestrians([pedestrian({ ...overrides, t: step / steps })]);
    clock.now += MESSAGE_MS;
    view.updateFrame(clock.now);
    sample();
  }
};

describe('PedestriansView', () => {
  it('can present the full simulation pedestrian cap', () => {
    expect(PEDESTRIAN_CAPACITY).toBeGreaterThanOrEqual(MAX_PEDESTRIANS);
  });

  it('uses seven non-shadow batches: one rigid body plus four swinging limbs', () => {
    const view = new PedestriansView(10);

    expect(view.group.name).toBe('pedestrians');
    expect(view.group.children).toEqual(batches(view));
    expect(batches(view).map((mesh) => mesh.name)).toEqual([
      'pedestrian-tops',
      'pedestrian-bottoms',
      'pedestrian-heads',
      'pedestrian-left-legs',
      'pedestrian-right-legs',
      'pedestrian-left-arms',
      'pedestrian-right-arms',
    ]);
    // The three body layers are rigid together and share one transform buffer;
    // each limb carries its own joint rotation, so it needs its own.
    expect(view.bottomMesh.instanceMatrix).toBe(view.topMesh.instanceMatrix);
    expect(view.headMesh.instanceMatrix).toBe(view.topMesh.instanceMatrix);
    expect(new Set(batches(view).map((mesh) => mesh.instanceMatrix)).size).toBe(5);
    expect(new Set(batches(view).map((mesh) => mesh.instanceColor)).size).toBe(7);
    for (const mesh of batches(view)) {
      expect(mesh.instanceMatrix.count).toBe(PEDESTRIAN_CAPACITY);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.count).toBe(0);
    }
    const headZs = axisValues(view.headMesh.geometry, 2);
    expect(Math.max(...headZs)).toBeGreaterThan(0.08);
    expect(view.count).toBe(0);
  });

  it('builds every limb with its joint at the geometry origin', () => {
    const view = new PedestriansView(10);
    const limbs: [InstancedMesh, number][] = [
      [view.legLeftMesh, PEDESTRIAN_LEG.length],
      [view.legRightMesh, PEDESTRIAN_LEG.length],
      [view.armLeftMesh, PEDESTRIAN_ARM.length],
      [view.armRightMesh, PEDESTRIAN_ARM.length],
    ];

    for (const [mesh, length] of limbs) {
      const ys = axisValues(mesh.geometry, 1);
      // Pivot at the origin with the limb hanging below it, so the instance
      // matrix alone swings it about the hip or shoulder.
      expect(Math.max(...ys)).toBeCloseTo(0, 6);
      expect(Math.min(...ys)).toBeCloseTo(-length, 6);
    }
  });

  it('renders simultaneous opposing walkers on opposite sidewalk sides', () => {
    const view = new PedestriansView(10, () => 100);
    view.setPedestrians([
      pedestrian({ id: 1, fromCell: 0, toCell: 1 }),
      pedestrian({ id: 2, fromCell: 1, toCell: 0 }),
    ]);
    const forwardPose = poseAt(view, 0);
    expect(forwardPose.x).toBeCloseTo(1, 5);
    expect(forwardPose.y).toBeCloseTo(PEDESTRIAN_Y, 5);
    expect(forwardPose.z).toBeCloseTo(0.5 - PEDESTRIAN_CURB_OFFSET, 5);
    expect(forwardPose.yaw).toBeCloseTo(Math.PI / 2, 5);

    const reversePose = poseAt(view, 1);
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

  it('clears every batch and interpolation history for an empty full-list update', () => {
    let now = 100;
    const view = new PedestriansView(10, () => now);
    view.setPedestrians([pedestrian({ id: 7 })]);

    now = 200;
    view.setPedestrians([]);
    expect(view.count).toBe(0);
    for (const mesh of batches(view)) expect(mesh.count).toBe(0);

    now = 300;
    view.setPedestrians([
      pedestrian({ id: 7, fromCell: 1, toCell: 11 }),
    ]);
    const returned = poseAt(view);
    expect(returned.x).toBeCloseTo(1.5 + PEDESTRIAN_CURB_OFFSET, 5);
    expect(returned.z).toBeCloseTo(1, 5);
    expect(returned.yaw).toBeCloseTo(0, 5);
  });

  it('caps live instances and keeps tops inside trip-purpose color families', () => {
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
    for (const mesh of batches(view)) expect(mesh.count).toBe(PEDESTRIAN_CAPACITY);
    for (let slot = 0; slot < purposes.length; slot++) {
      expect(PEDESTRIAN_PURPOSE_TOP_PALETTES[purposes[slot]]).toContain(
        colorAt(view.topMesh, slot),
      );
    }
  });

  it('dresses the limbs in the identity garments', () => {
    const view = new PedestriansView(10, () => 100);
    view.setPedestrians([pedestrian({ id: 12, generation: 4 })]);
    const style = pedestrianStyle(12, 4, 'commercial-work');

    expect(colorAt(view.bottomMesh, 0)).toBe(style.bottomColor);
    expect(colorAt(view.legLeftMesh, 0)).toBe(style.bottomColor);
    expect(colorAt(view.legRightMesh, 0)).toBe(style.bottomColor);
    expect(colorAt(view.armLeftMesh, 0)).toBe(style.sleeveColor);
    expect(colorAt(view.armRightMesh, 0)).toBe(style.sleeveColor);
    expect([style.topColor, style.skinColor]).toContain(style.sleeveColor);
  });

  it('scissors the legs and counter-swings the arms along the walking direction', () => {
    const clock = { now: 0 };
    const view = new PedestriansView(10, () => clock.now);
    const swings: { legs: number; arms: number }[] = [];

    // Heading +z (yaw 0), so a forward swing shows up directly in world z.
    walkOneCell(view, clock, { id: 3, fromCell: 0, toCell: 10 }, () => {
      swings.push({
        legs: footOf(view, 'left').z - footOf(view, 'right').z,
        arms: handOf(view, 'left').z - handOf(view, 'right').z,
      });
    });

    expect(Math.max(...swings.map((swing) => Math.abs(swing.legs)))).toBeGreaterThan(0.08);
    expect(Math.max(...swings.map((swing) => Math.abs(swing.arms)))).toBeGreaterThan(0.03);
    for (const { legs, arms } of swings) {
      if (Math.abs(legs) < 1e-6) continue;
      expect(Math.sign(arms)).toBe(-Math.sign(legs));
    }
  });

  it('keeps both feet on the pavement through the whole cycle', () => {
    const clock = { now: 0 };
    const view = new PedestriansView(10, () => clock.now);
    view.setTerrainSurface(flatRaisedSurface(0.4));
    const hipYs: number[] = [];

    walkOneCell(view, clock, { id: 4, fromCell: 0, toCell: 10 }, () => {
      expect(footOf(view, 'left').y).toBeCloseTo(0.4 + PEDESTRIAN_Y, 6);
      expect(footOf(view, 'right').y).toBeCloseTo(0.4 + PEDESTRIAN_Y, 6);
      hipYs.push(new Vector3().setFromMatrixPosition(matrixOf(view.topMesh, 0)).y);
    });

    // The hip really does bob: it dips as the legs split and never rises above
    // its standing height.
    expect(Math.max(...hipYs) - Math.min(...hipYs)).toBeGreaterThan(0.004);
  });

  it('carries the walk cycle continuously around a corner', () => {
    const clock = { now: 0 };
    const view = new PedestriansView(10, () => clock.now);

    // The end of the +x segment and the start of the +z segment are the same
    // point on the path, so the walk cycle must hand over untouched. The curb
    // offset swings right across the lane here; if it leaked into the odometer
    // the legs would spasm at every turn.
    view.setPedestrians([pedestrian({ id: 6, fromCell: 0, toCell: 1, t: 0.999 })]);
    clock.now += MESSAGE_MS;
    view.updateFrame(clock.now);
    const beforeTurn = strideOf(view);

    view.setPedestrians([pedestrian({ id: 6, fromCell: 1, toCell: 11, t: 0 })]);
    clock.now += MESSAGE_MS;
    view.updateFrame(clock.now);

    expect(poseAt(view).yaw).toBeCloseTo(0, 5);
    expect(strideOf(view)).toBeCloseTo(beforeTurn, 2);
  });

  it('advances the walk cycle with distance travelled, never with the clock', () => {
    let now = 0;
    const view = new PedestriansView(10, () => now);
    view.setPedestrians([pedestrian({ id: 5, t: 0 })]);
    now += 50;
    view.setPedestrians([pedestrian({ id: 5, t: 0.4 })]);
    now += 50;
    view.updateFrame(now);
    const walked = snapshotOf(view);

    // Frames keep arriving while the walker stands still: the pose must not budge.
    for (const idle of [16, 100, 1000, 60_000]) {
      now += idle;
      view.updateFrame(now);
      expect(snapshotOf(view)).toEqual(walked);
    }

    // A paused game re-posts the same progress forever; still a held pose.
    for (let repeat = 0; repeat < 8; repeat++) {
      view.setPedestrians([pedestrian({ id: 5, t: 0.4 })]);
      now += 50;
      view.updateFrame(now);
      expect(snapshotOf(view)).toEqual(walked);
    }

    // Only travel moves the limbs.
    view.setPedestrians([pedestrian({ id: 5, t: 0.75 })]);
    now += 50;
    view.updateFrame(now);
    expect(snapshotOf(view)).not.toEqual(walked);
  });

  it('keeps walkers sharing one route out of lockstep', () => {
    const view = new PedestriansView(10, () => 100);
    const crowd = Array.from({ length: 16 }, (_, id) =>
      pedestrian({ id, fromCell: 0, toCell: 10, t: 0.5 }),
    );

    view.setPedestrians(crowd);

    // Same segment, same progress: only the identity hash separates them.
    const swings = crowd.map(
      (_, slot) => footOf(view, 'left', slot).z - footOf(view, 'right', slot).z,
    );
    expect(new Set(swings.map((swing) => swing.toFixed(3))).size).toBeGreaterThanOrEqual(12);
    expect(pedestrianGait(0, 0)).not.toEqual(pedestrianGait(1, 0));
  });

  it('keeps the swinging silhouette inside the sidewalk lane', () => {
    const laneFromEdge = 0.5 - PEDESTRIAN_CURB_OFFSET;

    // Arms, not the torso, are now the widest part of a walker.
    expect(PEDESTRIAN_MAX_HALF_WIDTH).toBeGreaterThan(
      (PEDESTRIAN_BODY.width * PEDESTRIAN_MAX_WIDTH_SCALE) / 2,
    );
    expect(PEDESTRIAN_MAX_HALF_WIDTH).toBeCloseTo(
      (PEDESTRIAN_ARM.x + PEDESTRIAN_ARM.width / 2) * PEDESTRIAN_MAX_WIDTH_SCALE,
      6,
    );
    expect(laneFromEdge - TRAFFIC_SIGNAL_CORNER_INSET).toBeGreaterThan(
      PEDESTRIAN_MAX_HALF_WIDTH + TRAFFIC_SIGNAL_POLE_HALF_WIDTH,
    );
  });
});
