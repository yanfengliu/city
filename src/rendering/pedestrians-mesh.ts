import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  OctahedronGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PedestrianView } from '../protocol/messages';
import {
  PEDESTRIAN_ARM,
  PEDESTRIAN_BODY,
  PEDESTRIAN_CAPACITY,
  PEDESTRIAN_CURB_OFFSET,
  PEDESTRIAN_HEAD,
  PEDESTRIAN_HIP,
  PEDESTRIAN_HIP_JOINT_Y,
  PEDESTRIAN_LEG,
  VEHICLE_LERP_DEFAULT_MS,
  VEHICLE_LERP_MAX_MS,
  VEHICLE_LERP_MIN_MS,
} from './constants';
import {
  pedestrianGait,
  pedestrianGaitPoseInto,
  type PedestrianGait,
  type PedestrianPose,
} from './pedestrian-gait';
import {
  PEDESTRIAN_Y,
  pedestrianStyle,
  type PedestrianStyle,
} from './pedestrian-style';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';
import {
  retargetVehicleMotion,
  sampleVehicleMotionInto,
  type VehicleMotionPose,
  type VehicleMotionSegment,
} from './vehicle-motion';

interface PedestrianState {
  generation: number;
  /** The household this walker is carrying — what a click on them selects. */
  citizen: number | null;
  style: PedestrianStyle;
  gait: PedestrianGait;
  motion: VehicleMotionSegment;
  /** Odometer reading presented just before the newest message, in cells. */
  fromProgress: number;
  /** Odometer reading the newest message asks for, in cells. */
  toProgress: number;
}

interface SampledSegment {
  pose: VehicleMotionPose;
  progress: number;
}

const ROOT = new Matrix4();
const TORSO = new Matrix4();
const JOINT = new Matrix4();
const LIMB = new Matrix4();
const SCALE = new Vector3();
const MOTION_POSE = { x: 0, z: 0, yaw: 0 };
const POSE: PedestrianPose = {
  leftLegSwing: 0,
  rightLegSwing: 0,
  leftArmSwing: 0,
  rightArmSwing: 0,
  bob: 0,
  lean: 0,
};
const COLOR = new Color();

/**
 * Composes `parent · translate(joint) · rotateX(angle)` into `out` — the
 * instanced-limb trick. Limb geometry is authored with its joint at the origin,
 * so the instance matrix alone carries the swing and no limb needs its own
 * object in the scene graph.
 *
 * Runs five times per walker per frame. A full frame at the 256-walker cap
 * measures well under a tenth of a millisecond, so this stays in its readable
 * form rather than a hand-unrolled one. `out` must not alias JOINT or `parent`.
 */
const jointInto = (
  out: Matrix4,
  parent: Matrix4,
  x: number,
  y: number,
  angle: number,
): Matrix4 => out.multiplyMatrices(parent, JOINT.makeRotationX(angle).setPosition(x, y, 0));

/**
 * Visible purposeful trips as fixed-capacity low-poly people who actually walk.
 * Torso, lower garment, and head are rigid together and share one transform
 * buffer; two legs and two arms swing about their hip and shoulder joints in
 * their own batches. The cycle is a pure function of distance travelled and the
 * walker's identity hash (see pedestrian-gait), so it costs no clock and no
 * per-frame state. Deterministic identity styling keeps purpose-readable top
 * palettes while varying clothes, sleeves, skin tone, height, build, and gait.
 */
export class PedestriansView {
  readonly group = new Group();
  readonly topMesh: InstancedMesh;
  readonly bottomMesh: InstancedMesh;
  readonly headMesh: InstancedMesh;
  readonly legLeftMesh: InstancedMesh;
  readonly legRightMesh: InstancedMesh;
  readonly armLeftMesh: InstancedMesh;
  readonly armRightMesh: InstancedMesh;
  private readonly batches: readonly InstancedMesh[];
  private states = new Map<number, PedestrianState>();
  private lastMessageAt: number | null = null;
  private messageIntervalMs = VEHICLE_LERP_DEFAULT_MS;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor(
    private readonly gridWidth: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    // Body parts are authored about the hip joint so one shared instance
    // matrix can pitch the whole upper body forward about it.
    const hipRelative = (y: number): number => y - PEDESTRIAN_HIP_JOINT_Y;
    const torsoGeometry = new BoxGeometry(
      PEDESTRIAN_BODY.width,
      PEDESTRIAN_BODY.height,
      PEDESTRIAN_BODY.depth,
    ).translate(0, hipRelative(PEDESTRIAN_BODY.y), 0);
    const hipGeometry = new BoxGeometry(
      PEDESTRIAN_HIP.width,
      PEDESTRIAN_HIP.height,
      PEDESTRIAN_HIP.depth,
    ).translate(0, hipRelative(PEDESTRIAN_HIP.y), 0);

    const head = new OctahedronGeometry(PEDESTRIAN_HEAD.radius, 0)
      .translate(0, hipRelative(PEDESTRIAN_HEAD.y), 0);
    const nose = new OctahedronGeometry(PEDESTRIAN_HEAD.noseRadius, 0)
      .scale(PEDESTRIAN_HEAD.noseFlatten, PEDESTRIAN_HEAD.noseFlatten, 1)
      .translate(
        0,
        hipRelative(PEDESTRIAN_HEAD.y),
        PEDESTRIAN_HEAD.radius + PEDESTRIAN_HEAD.noseReach,
      );
    const headGeometry = mergeGeometries([head, nose]);
    head.dispose();
    nose.dispose();

    // Limbs hang from a joint at their own origin. The two sides are the same
    // box in opposite instance slots, so each pair shares one geometry.
    const legGeometry = new BoxGeometry(
      PEDESTRIAN_LEG.width,
      PEDESTRIAN_LEG.length,
      PEDESTRIAN_LEG.depth,
    ).translate(0, -PEDESTRIAN_LEG.length / 2, 0);
    const armGeometry = new BoxGeometry(
      PEDESTRIAN_ARM.width,
      PEDESTRIAN_ARM.length,
      PEDESTRIAN_ARM.depth,
    ).translate(0, -PEDESTRIAN_ARM.length / 2, 0);

    this.topMesh = makeBatch(torsoGeometry, 'pedestrian-tops');
    this.bottomMesh = makeBatch(hipGeometry, 'pedestrian-bottoms');
    this.headMesh = makeBatch(headGeometry, 'pedestrian-heads');
    this.legLeftMesh = makeBatch(legGeometry, 'pedestrian-left-legs');
    this.legRightMesh = makeBatch(legGeometry, 'pedestrian-right-legs');
    this.armLeftMesh = makeBatch(armGeometry, 'pedestrian-left-arms');
    this.armRightMesh = makeBatch(armGeometry, 'pedestrian-right-arms');
    // The three body layers move as one, so they share a transform buffer and
    // per-frame interpolation writes their pose once.
    this.bottomMesh.instanceMatrix = this.topMesh.instanceMatrix;
    this.headMesh.instanceMatrix = this.topMesh.instanceMatrix;
    this.batches = [
      this.topMesh,
      this.bottomMesh,
      this.headMesh,
      this.legLeftMesh,
      this.legRightMesh,
      this.armLeftMesh,
      this.armRightMesh,
    ];
    this.group.name = 'pedestrians';
    this.group.add(...this.batches);
  }

  get count(): number {
    return this.states.size;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    this.updateFrame(this.now());
  }

  /** Newest full pedestrian list; agents absent from it despawn immediately. */
  /**
   * Every batch this view draws, for hit-testing a click against the crowd.
   * All seven share one slot order, so any of them yields the same walker.
   */
  get pickableBatches(): readonly InstancedMesh[] {
    return this.batches;
  }

  /**
   * The household at an instance slot, or null when the slot is stale or the
   * walker predates the citizen field. Insertion order into `states` IS the
   * slot order — the same iteration fills the matrices and the colours.
   */
  citizenAtInstance(slot: number): number | null {
    if (slot < 0 || slot >= this.states.size) return null;
    let index = 0;
    for (const state of this.states.values()) {
      if (index++ === slot) return state.citizen;
    }
    return null;
  }

  setPedestrians(list: readonly PedestrianView[]): void {
    if (list.length === 0) {
      this.states.clear();
      for (const mesh of this.batches) mesh.count = 0;
      this.lastMessageAt = null;
      this.messageIntervalMs = VEHICLE_LERP_DEFAULT_MS;
      return;
    }

    const now = this.now();
    const previousAlpha = this.presentationAlpha(now);
    if (this.lastMessageAt !== null) {
      this.messageIntervalMs = Math.min(
        Math.max(now - this.lastMessageAt, VEHICLE_LERP_MIN_MS),
        VEHICLE_LERP_MAX_MS,
      );
    }
    this.lastMessageAt = now;

    const next = new Map<number, PedestrianState>();
    for (const pedestrian of list) {
      if (next.size === PEDESTRIAN_CAPACITY) break;
      const target = this.sampleSegment(pedestrian);
      const previous = this.states.get(pedestrian.id);
      const continuing = previous?.generation === pedestrian.generation
        ? previous
        : undefined;
      next.set(pedestrian.id, {
        generation: pedestrian.generation,
        citizen: pedestrian.citizen ?? null,
        style: pedestrianStyle(pedestrian.id, pedestrian.generation, pedestrian.purpose),
        gait: pedestrianGait(pedestrian.id, pedestrian.generation),
        motion: retargetVehicleMotion(continuing?.motion, previousAlpha, target.pose),
        // The odometer is retargeted like the pose: from what was on screen.
        fromProgress: continuing
          ? continuing.fromProgress +
            (continuing.toProgress - continuing.fromProgress) * previousAlpha
          : target.progress,
        toProgress: target.progress,
      });
    }
    this.states = next;
    for (const mesh of this.batches) mesh.count = next.size;
    this.applyStyles();
    this.updateFrame(now);
  }

  /** Interpolate all active walkers without allocating per-instance objects. */
  updateFrame(now: number): void {
    if (this.states.size === 0) return;
    const alpha = this.presentationAlpha(now);
    const shoulderY = PEDESTRIAN_ARM.y - PEDESTRIAN_HIP_JOINT_Y;
    let slot = 0;
    for (const state of this.states.values()) {
      const { x, z, yaw } = sampleVehicleMotionInto(state.motion, alpha, MOTION_POSE);
      const progress =
        state.fromProgress + (state.toProgress - state.fromProgress) * alpha;
      const pose = pedestrianGaitPoseInto(state.gait, progress, POSE);
      const { widthScale, heightScale } = state.style;
      ROOT.makeRotationY(yaw).scale(
        SCALE.set(widthScale, heightScale, widthScale),
      ).setPosition(
        x,
        this.surface.heightAt(x, z) + PEDESTRIAN_Y,
        z,
      );
      // The hip rides the bob, so the legs and the upper body dip together and
      // the feet stay on the pavement. A limb hangs below its joint, so its
      // forward swing is a negative pitch; the upper body rises above the hip,
      // so its forward lean is a positive one.
      const hipY = PEDESTRIAN_HIP_JOINT_Y + pose.bob;
      this.topMesh.setMatrixAt(slot, jointInto(TORSO, ROOT, 0, hipY, pose.lean));
      this.legLeftMesh.setMatrixAt(
        slot,
        jointInto(LIMB, ROOT, -PEDESTRIAN_LEG.x, hipY, -pose.leftLegSwing),
      );
      this.legRightMesh.setMatrixAt(
        slot,
        jointInto(LIMB, ROOT, PEDESTRIAN_LEG.x, hipY, -pose.rightLegSwing),
      );
      // Arms hang off the leaning torso, not off the root, so they stay in
      // their sockets through the lean.
      this.armLeftMesh.setMatrixAt(
        slot,
        jointInto(LIMB, TORSO, -PEDESTRIAN_ARM.x, shoulderY, -pose.leftArmSwing),
      );
      this.armRightMesh.setMatrixAt(
        slot,
        jointInto(LIMB, TORSO, PEDESTRIAN_ARM.x, shoulderY, -pose.rightArmSwing),
      );
      slot++;
    }
    for (const mesh of this.batches) mesh.instanceMatrix.needsUpdate = true;
  }

  private presentationAlpha(now: number): number {
    return this.lastMessageAt === null
      ? 1
      : Math.min(1, Math.max(0, (now - this.lastMessageAt) / this.messageIntervalMs));
  }

  /**
   * The walker's world pose plus its odometer reading.
   *
   * The odometer is the centreline position summed as `x + z`. Road segments
   * are unit cell steps, so one cell of travel moves it by exactly one, and
   * successive segments share a cell centre, so it stays continuous through a
   * turn. Down-grid steps count it down, which only mirrors the cycle. The curb
   * offset is deliberately left out of it: that offset swings across the lane
   * when a walker turns a corner, which would spasm the legs at every turn.
   */
  private sampleSegment(pedestrian: PedestrianView): SampledSegment {
    const ax = (pedestrian.fromCell % this.gridWidth) + 0.5;
    const az = Math.floor(pedestrian.fromCell / this.gridWidth) + 0.5;
    const bx = (pedestrian.toCell % this.gridWidth) + 0.5;
    const bz = Math.floor(pedestrian.toCell / this.gridWidth) + 0.5;
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    const t = Math.min(1, Math.max(0, pedestrian.t));
    if (length === 0) return { pose: { x: ax, z: az, yaw: 0 }, progress: ax + az };
    const cx = ax + dx * t;
    const cz = az + dz * t;
    return {
      pose: {
        x: cx + (dz / length) * PEDESTRIAN_CURB_OFFSET,
        z: cz - (dx / length) * PEDESTRIAN_CURB_OFFSET,
        yaw: Math.atan2(dx, dz),
      },
      progress: cx + cz,
    };
  }

  private applyStyles(): void {
    let slot = 0;
    for (const state of this.states.values()) {
      const { topColor, bottomColor, sleeveColor, skinColor } = state.style;
      this.topMesh.setColorAt(slot, COLOR.setHex(topColor));
      this.bottomMesh.setColorAt(slot, COLOR.setHex(bottomColor));
      this.headMesh.setColorAt(slot, COLOR.setHex(skinColor));
      this.legLeftMesh.setColorAt(slot, COLOR.setHex(bottomColor));
      this.legRightMesh.setColorAt(slot, COLOR.setHex(bottomColor));
      this.armLeftMesh.setColorAt(slot, COLOR.setHex(sleeveColor));
      this.armRightMesh.setColorAt(slot, COLOR.setHex(sleeveColor));
      slot++;
    }
    for (const mesh of this.batches) mesh.instanceColor!.needsUpdate = true;
  }
}

function makeBatch(geometry: BufferGeometry, name: string): InstancedMesh {
  const mesh = new InstancedMesh(
    geometry,
    new MeshLambertMaterial({ color: 0xffffff }),
    PEDESTRIAN_CAPACITY,
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(
    new Float32Array(PEDESTRIAN_CAPACITY * 3),
    3,
  );
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.name = name;
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}
