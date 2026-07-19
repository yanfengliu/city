import { describe, expect, it } from 'vitest';
import { PEDESTRIAN_GAIT, PEDESTRIAN_LEG } from '../../src/rendering/constants';
import {
  pedestrianGait,
  pedestrianGaitPoseInto,
  type PedestrianGait,
  type PedestrianPose,
} from '../../src/rendering/pedestrian-gait';

/** No per-person variation, so a test can reason in whole cycles. */
const NOMINAL: PedestrianGait = { phaseOffset: 0, strideCells: 1, swingScale: 1 };

const blankPose = (): PedestrianPose => ({
  leftLegSwing: 0,
  rightLegSwing: 0,
  leftArmSwing: 0,
  rightArmSwing: 0,
  bob: 0,
  lean: 0,
});

const poseOf = (gait: PedestrianGait, progress: number): PedestrianPose =>
  pedestrianGaitPoseInto(gait, progress, blankPose());

/** One walker's poses sampled evenly across `cycles` strides of travel. */
const walked = (gait: PedestrianGait, cycles = 2, steps = 64): PedestrianPose[] =>
  Array.from({ length: steps }, (_, i) =>
    poseOf(gait, (i * cycles * gait.strideCells) / steps),
  );

const identities = (count: number): PedestrianGait[] =>
  Array.from({ length: count }, (_, id) => pedestrianGait(id, 0, 0));

const POSE_KEYS = Object.keys(blankPose()) as (keyof PedestrianPose)[];

describe('pedestrianGaitPoseInto', () => {
  it('derives the pose from travelled distance alone', () => {
    const gait = pedestrianGait(7, 2, 1);
    const pose = poseOf(gait, 3.25);

    // Same walker, same point on its path: byte-identical however often it is
    // asked and whenever it is asked. Nothing in here reads a clock.
    for (let repeat = 0; repeat < 32; repeat++) {
      expect(poseOf(pedestrianGait(7, 2, 1), 3.25)).toEqual(pose);
    }
    expect(poseOf(gait, 3.25 + gait.strideCells / 4)).not.toEqual(pose);
  });

  it('writes into caller-owned storage instead of allocating a pose', () => {
    const out = blankPose();

    expect(pedestrianGaitPoseInto(NOMINAL, 0.3, out)).toBe(out);
    expect(out.leftLegSwing).not.toBe(0);
  });

  it('swings the two legs in antiphase', () => {
    const poses = walked(NOMINAL);

    for (const pose of poses) expect(pose.leftLegSwing).toBe(-pose.rightLegSwing);
    expect(Math.max(...poses.map((pose) => Math.abs(pose.leftLegSwing)))).toBeCloseTo(
      PEDESTRIAN_GAIT.legSwing,
      6,
    );
  });

  it('counter-swings each arm against the leg on its own side', () => {
    let swinging = 0;

    for (const pose of walked(NOMINAL)) {
      expect(pose.leftArmSwing).toBe(-pose.rightArmSwing);
      if (Math.abs(pose.leftLegSwing) < 1e-6) continue;
      swinging++;
      expect(Math.sign(pose.leftArmSwing)).toBe(-Math.sign(pose.leftLegSwing));
      expect(Math.sign(pose.rightArmSwing)).toBe(-Math.sign(pose.rightLegSwing));
    }

    expect(swinging).toBeGreaterThan(50);
  });

  it('completes exactly one cycle per stride of travel', () => {
    const gait = pedestrianGait(11, 0, 2);

    for (const progress of [0, 0.37, 1.4, 9.75]) {
      const pose = poseOf(gait, progress);
      const cycleLater = poseOf(gait, progress + gait.strideCells);
      for (const key of POSE_KEYS) expect(cycleLater[key]).toBeCloseTo(pose[key], 9);
      // Half a stride on, the two legs have traded places.
      expect(poseOf(gait, progress + gait.strideCells / 2).leftLegSwing).toBeCloseTo(
        -pose.leftLegSwing,
        9,
      );
    }
  });

  it('keeps limb swing inside a sane angular envelope', () => {
    const widest = 1 + PEDESTRIAN_GAIT.swingVariance / 2;
    const legCeiling = PEDESTRIAN_GAIT.legSwing * widest;
    const armCeiling = PEDESTRIAN_GAIT.armSwing * widest;

    // A walk, not a goose step: under 30 degrees at the hip, less at the shoulder.
    expect(legCeiling).toBeLessThan(0.52);
    expect(PEDESTRIAN_GAIT.legSwing).toBeGreaterThan(0.15);
    expect(armCeiling).toBeLessThan(legCeiling);
    for (const gait of identities(64)) {
      for (const pose of walked(gait)) {
        expect(Math.abs(pose.leftLegSwing)).toBeLessThanOrEqual(legCeiling + 1e-12);
        expect(Math.abs(pose.rightLegSwing)).toBeLessThanOrEqual(legCeiling + 1e-12);
        expect(Math.abs(pose.leftArmSwing)).toBeLessThanOrEqual(armCeiling + 1e-12);
        expect(Math.abs(pose.rightArmSwing)).toBeLessThanOrEqual(armCeiling + 1e-12);
      }
    }
  });

  it('drops the hip by exactly the scissor geometry, so feet never leave the pavement', () => {
    for (const gait of identities(16)) {
      for (const pose of walked(gait)) {
        const hip = PEDESTRIAN_LEG.length + pose.bob;
        expect(hip - PEDESTRIAN_LEG.length * Math.cos(pose.leftLegSwing)).toBeCloseTo(0, 12);
        expect(hip - PEDESTRIAN_LEG.length * Math.cos(pose.rightLegSwing)).toBeCloseTo(0, 12);
        expect(pose.bob).toBeLessThanOrEqual(0);
      }
    }

    const bobs = walked(NOMINAL).map((pose) => pose.bob);
    expect(Math.min(...bobs)).toBeLessThan(-0.008);
    expect(Math.max(...bobs)).toBeCloseTo(0, 9);
  });

  it('leans the upper body forward all cycle and rocks it twice per stride', () => {
    const leans = walked(NOMINAL).map((pose) => pose.lean);

    expect(Math.min(...leans)).toBeGreaterThan(0);
    expect(Math.max(...leans)).toBeLessThan(0.15);
    expect(Math.max(...leans) - Math.min(...leans)).toBeGreaterThan(0.005);
    // The rock repeats twice per stride: upright as the legs pass, furthest
    // forward at full split.
    expect(poseOf(NOMINAL, 0.5).lean).toBeCloseTo(poseOf(NOMINAL, 0).lean, 9);
    expect(poseOf(NOMINAL, 0).lean).toBeCloseTo(
      PEDESTRIAN_GAIT.lean - PEDESTRIAN_GAIT.leanSway,
      9,
    );
    expect(poseOf(NOMINAL, 0.25).lean).toBeCloseTo(
      PEDESTRIAN_GAIT.lean + PEDESTRIAN_GAIT.leanSway,
      9,
    );
  });

  it('mirrors the cycle when the odometer runs backwards', () => {
    // A walker heading -x/-z counts its distance down rather than up. The pose
    // must stay a valid walk with the two legs swapped, never a frozen slide.
    for (const progress of [0.13, 0.5, 1.9]) {
      const forward = poseOf(NOMINAL, progress);
      const backward = poseOf(NOMINAL, -progress);

      expect(backward.leftLegSwing).toBeCloseTo(forward.rightLegSwing, 12);
      expect(backward.leftArmSwing).toBeCloseTo(forward.rightArmSwing, 12);
      expect(backward.bob).toBeCloseTo(forward.bob, 12);
      expect(backward.lean).toBeCloseTo(forward.lean, 12);
    }
  });
});

describe('pedestrianGait', () => {
  it('varies cadence, swing, and phase across identities', () => {
    const gaits = identities(64);

    expect(new Set(gaits.map((gait) => gait.phaseOffset)).size).toBeGreaterThanOrEqual(60);
    expect(new Set(gaits.map((gait) => gait.strideCells)).size).toBeGreaterThanOrEqual(60);
    expect(new Set(gaits.map((gait) => gait.swingScale)).size).toBeGreaterThanOrEqual(60);
    // Same route, same progress: walkers fall in step only when their hash agrees.
    expect(
      new Set(gaits.map((gait) => JSON.stringify(poseOf(gait, 2.5)))).size,
    ).toBeGreaterThanOrEqual(60);
    expect(pedestrianGait(9, 1, 2)).toEqual(pedestrianGait(9, 1, 2));
    expect(pedestrianGait(9, 2, 2)).not.toEqual(pedestrianGait(9, 1, 2));
    expect(pedestrianGait(9, 1, 1)).not.toEqual(pedestrianGait(9, 1, 2));
  });

  it('keeps every identity inside the tuned cadence and swing spread', () => {
    const strideSpread = PEDESTRIAN_GAIT.strideCells * (PEDESTRIAN_GAIT.strideVariance / 2);

    for (const gait of identities(256)) {
      expect(gait.phaseOffset).toBeGreaterThanOrEqual(0);
      expect(gait.phaseOffset).toBeLessThan(1);
      expect(gait.strideCells).toBeGreaterThan(PEDESTRIAN_GAIT.strideCells - strideSpread - 1e-12);
      expect(gait.strideCells).toBeLessThan(PEDESTRIAN_GAIT.strideCells + strideSpread + 1e-12);
      expect(gait.swingScale).toBeGreaterThan(1 - PEDESTRIAN_GAIT.swingVariance / 2 - 1e-12);
      expect(gait.swingScale).toBeLessThan(1 + PEDESTRIAN_GAIT.swingVariance / 2 + 1e-12);
    }
  });
});
