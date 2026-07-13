export interface VehicleMotionPose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export interface MutableVehicleMotionPose {
  x: number;
  z: number;
  yaw: number;
}

export interface VehicleMotionSegment {
  readonly from: VehicleMotionPose;
  readonly to: VehicleMotionPose;
}

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const shortestYawDelta = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Samples into caller-owned storage. Retargeting unwraps the destination yaw,
 * so this render-frame path performs no shortest-arc trig and allocates nothing.
 */
export const sampleVehicleMotionInto = (
  motion: VehicleMotionSegment,
  alpha: number,
  output: MutableVehicleMotionPose,
): MutableVehicleMotionPose => {
  const t = clampUnit(alpha);
  output.x = motion.from.x + (motion.to.x - motion.from.x) * t;
  output.z = motion.from.z + (motion.to.z - motion.from.z) * t;
  output.yaw = motion.from.yaw + (motion.to.yaw - motion.from.yaw) * t;
  return output;
};

/** Convenience allocating sampler for tests and non-frame consumers. */
export const interpolateVehicleMotion = (
  motion: VehicleMotionSegment,
  alpha: number,
): VehicleMotionPose => sampleVehicleMotionInto(motion, alpha, { x: 0, z: 0, yaw: 0 });

/**
 * Starts a new segment at the pose that was presented immediately before the
 * message arrived. A new vehicle has no prior segment and appears at its first
 * sampled pose without flying in from an unrelated origin.
 */
export const retargetVehicleMotion = (
  previous: VehicleMotionSegment | undefined,
  previousAlpha: number,
  target: VehicleMotionPose,
): VehicleMotionSegment => {
  const from = previous ? interpolateVehicleMotion(previous, previousAlpha) : target;
  return {
    from,
    to: {
      ...target,
      yaw: from.yaw + shortestYawDelta(from.yaw, target.yaw),
    },
  };
};
