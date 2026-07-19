import { PEDESTRIAN_GAIT, PEDESTRIAN_LEG } from './constants';
import { identityDraw, pedestrianIdentitySeed } from './pedestrian-style';

/**
 * The pedestrian walk cycle, as pure maths over distance travelled.
 *
 * A walker's phase is a function of how far along its path it is and of its
 * identity hash — never of a clock. That is what makes the animation free: a
 * paused game holds a static pose, a stalled walker holds its stride, two
 * people at the same point on the same route fall in step only if their hashes
 * agree, and no per-frame state has to be kept anywhere. (Contrast the wind
 * turbines, which genuinely do spin from the presentation clock.)
 *
 * Sign convention: a positive swing carries that limb's free end forward, and a
 * positive lean pitches the upper body forward. The renderer negates the limb
 * angles when it builds the instance matrices, because limbs hang below their
 * joint while the upper body rises above it.
 */

const TAU = Math.PI * 2;

/** Per-person constants — everything about a walk that never changes. */
export interface PedestrianGait {
  /** Cycle offset in [0, 1): decorrelates walkers sharing a route. */
  phaseOffset: number;
  /** Cells of travel per full two-step cycle. */
  strideCells: number;
  /** Multiplier on both nominal swing peaks. */
  swingScale: number;
}

/** One sampled instant of the cycle. Reused across frames; never allocated per walker. */
export interface PedestrianPose {
  leftLegSwing: number;
  rightLegSwing: number;
  leftArmSwing: number;
  rightArmSwing: number;
  /** Hip height offset, world units and never positive: the scissor drop. */
  bob: number;
  /** Forward pitch of the upper body about the hip, radians. */
  lean: number;
}

/** Spread a unit draw across `1 ± variance / 2`. */
const spread = (draw: number, variance: number): number => 1 + (draw - 0.5) * variance;

/** Stable for one live pedestrian identity; a recycled generation walks anew. */
export function pedestrianGait(id: number, generation: number): PedestrianGait {
  const seed = pedestrianIdentitySeed(id, generation);
  return {
    phaseOffset: identityDraw(seed, 0x1f83d9ab),
    strideCells:
      PEDESTRIAN_GAIT.strideCells *
      spread(identityDraw(seed, 0x5be0cd19), PEDESTRIAN_GAIT.strideVariance),
    swingScale: spread(identityDraw(seed, 0x9b05688c), PEDESTRIAN_GAIT.swingVariance),
  };
}

/**
 * Samples the cycle into caller-owned storage.
 *
 * `progress` is distance travelled along the path, in cells. It may run
 * backwards — a walker heading down-grid counts down — which simply mirrors the
 * cycle: the pose is even in phase apart from the two limb pairs, and swapping
 * left for right is still a walk.
 *
 * The hip drop is exactly the geometry the scissoring legs demand
 * (`L - L·cos θ`), so both feet stay on the pavement at every phase instead of
 * floating or sinking through it.
 */
export function pedestrianGaitPoseInto(
  gait: PedestrianGait,
  progress: number,
  out: PedestrianPose,
): PedestrianPose {
  const phase = (progress / gait.strideCells + gait.phaseOffset) * TAU;
  const swing = Math.sin(phase);
  const leg = PEDESTRIAN_GAIT.legSwing * gait.swingScale * swing;
  const arm = PEDESTRIAN_GAIT.armSwing * gait.swingScale * swing;
  out.leftLegSwing = leg;
  out.rightLegSwing = -leg;
  out.leftArmSwing = -arm;
  out.rightArmSwing = arm;
  out.bob = -PEDESTRIAN_LEG.length * (1 - Math.cos(leg));
  // Twice per cycle: the torso tips forward at full split, upright as the legs pass.
  out.lean = PEDESTRIAN_GAIT.lean - PEDESTRIAN_GAIT.leanSway * Math.cos(phase * 2);
  return out;
}
