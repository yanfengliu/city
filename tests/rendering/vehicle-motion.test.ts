import { describe, expect, it, vi } from 'vitest';
import {
  interpolateVehicleMotion,
  retargetVehicleMotion,
  sampleVehicleMotionInto,
  type VehicleMotionPose,
  type VehicleMotionSegment,
} from '../../src/rendering/vehicle-motion';

const pose = (x: number, z: number, yaw: number): VehicleMotionPose => ({ x, z, yaw });

describe('vehicle motion', () => {
  it('interpolates position and yaw continuously through a 90-degree corner', () => {
    const approach: VehicleMotionSegment = {
      from: pose(0, 0, 0),
      to: pose(2, 0, 0),
    };

    const turn = retargetVehicleMotion(approach, 0.5, pose(1, 2, Math.PI / 2));

    expect(turn.from).toEqual(pose(1, 0, 0));
    expect(interpolateVehicleMotion(turn, 0.5)).toEqual(pose(1, 1, Math.PI / 4));
  });

  it('takes the shortest yaw arc across the pi wraparound', () => {
    const degrees = (value: number): number => (value * Math.PI) / 180;
    const initial = retargetVehicleMotion(undefined, 1, pose(0, 0, degrees(179)));
    const motion = retargetVehicleMotion(initial, 1, pose(0, 0, degrees(-179)));

    const halfway = interpolateVehicleMotion(motion, 0.5);

    expect(Math.abs(halfway.yaw)).toBeCloseTo(Math.PI, 10);
  });

  it('retargets early and jittered messages from the currently presented pose', () => {
    const first: VehicleMotionSegment = {
      from: pose(0, 0, 0),
      to: pose(10, 0, 0),
    };
    const second = retargetVehicleMotion(first, 0.25, pose(20, 0, Math.PI / 2));
    const presentedBeforeThird = interpolateVehicleMotion(second, 0.2);

    const third = retargetVehicleMotion(second, 0.2, pose(20, 10, Math.PI));

    expect(second.from).toEqual(pose(2.5, 0, 0));
    expect(third.from).toEqual(presentedBeforeThird);
    expect(third.from.x).toBeCloseTo(6, 10);
    expect(third.from.yaw).toBeCloseTo(Math.PI / 10, 10);
  });

  it('places a new spawn directly at its first sampled pose', () => {
    const target = pose(4, 7, -Math.PI / 3);

    const motion = retargetVehicleMotion(undefined, 0.3, target);

    expect(motion).toEqual({ from: target, to: target });
    expect(interpolateVehicleMotion(motion, 0)).toEqual(target);
  });

  it('samples into caller-owned storage without shortest-arc trig in the frame path', () => {
    const degrees = (value: number): number => (value * Math.PI) / 180;
    const initial = retargetVehicleMotion(undefined, 1, pose(0, 0, degrees(179)));
    const motion = retargetVehicleMotion(initial, 1, pose(2, 4, degrees(-179)));
    const output = { x: 0, z: 0, yaw: 0 };
    const atan2 = vi.spyOn(Math, 'atan2').mockImplementation(() => {
      throw new Error('shortest-arc trig must be precomputed during retargeting');
    });

    expect(sampleVehicleMotionInto(motion, 0.5, output)).toBe(output);
    expect(output.x).toBe(1);
    expect(output.z).toBe(2);
    expect(Math.abs(output.yaw)).toBeCloseTo(Math.PI, 10);

    atan2.mockRestore();
  });
});
