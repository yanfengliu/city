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
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PedestrianPurpose, PedestrianView } from '../protocol/messages';
import {
  PEDESTRIAN_BODY,
  PEDESTRIAN_CAPACITY,
  PEDESTRIAN_CURB_OFFSET,
  PEDESTRIAN_HEAD,
  PEDESTRIAN_LEG,
  PEDESTRIAN_PURPOSE_COLORS,
  PEDESTRIAN_SKIN_COLOR,
  PEDESTRIAN_Y,
  VEHICLE_LERP_DEFAULT_MS,
  VEHICLE_LERP_MAX_MS,
  VEHICLE_LERP_MIN_MS,
} from './constants';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';
import {
  retargetVehicleMotion,
  sampleVehicleMotionInto,
  type VehicleMotionSegment,
} from './vehicle-motion';

interface PedestrianState {
  generation: number;
  purpose: PedestrianPurpose;
  motion: VehicleMotionSegment;
}

const MATRIX = new Matrix4();
const MOTION_POSE = { x: 0, z: 0, yaw: 0 };
const COLOR = new Color();

/**
 * Visible purposeful trips as fixed-capacity low-poly people. Bodies and heads
 * share one instance transform buffer, so per-frame interpolation writes each
 * pedestrian pose once. Purpose is encoded on body color; heads stay a fixed
 * skin tone. Moving pedestrians intentionally neither cast nor receive shadows.
 */
export class PedestriansView {
  readonly group = new Group();
  readonly bodyMesh: InstancedMesh;
  readonly headMesh: InstancedMesh;
  private states = new Map<number, PedestrianState>();
  private lastMessageAt: number | null = null;
  private messageIntervalMs = VEHICLE_LERP_DEFAULT_MS;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor(
    private readonly gridWidth: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    const torso = new BoxGeometry(
      PEDESTRIAN_BODY.width,
      PEDESTRIAN_BODY.height,
      PEDESTRIAN_BODY.depth,
    ).translate(0, PEDESTRIAN_BODY.y, 0);
    const leftLeg = new BoxGeometry(
      PEDESTRIAN_LEG.width,
      PEDESTRIAN_LEG.height,
      PEDESTRIAN_LEG.depth,
    ).translate(-PEDESTRIAN_LEG.x, PEDESTRIAN_LEG.y, PEDESTRIAN_LEG.stride);
    const rightLeg = new BoxGeometry(
      PEDESTRIAN_LEG.width,
      PEDESTRIAN_LEG.height,
      PEDESTRIAN_LEG.depth,
    ).translate(PEDESTRIAN_LEG.x, PEDESTRIAN_LEG.y, -PEDESTRIAN_LEG.stride);
    const bodyGeometry = mergeGeometries([torso, leftLeg, rightLeg]);
    torso.dispose();
    leftLeg.dispose();
    rightLeg.dispose();

    const headGeometry = new OctahedronGeometry(PEDESTRIAN_HEAD.radius, 0)
      .translate(0, PEDESTRIAN_HEAD.y, 0);
    this.bodyMesh = new InstancedMesh(
      bodyGeometry,
      new MeshLambertMaterial({ color: 0xffffff }),
      PEDESTRIAN_CAPACITY,
    );
    this.headMesh = new InstancedMesh(
      headGeometry,
      new MeshLambertMaterial({ color: PEDESTRIAN_SKIN_COLOR }),
      PEDESTRIAN_CAPACITY,
    );
    this.bodyMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.headMesh.instanceMatrix = this.bodyMesh.instanceMatrix;
    this.bodyMesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(PEDESTRIAN_CAPACITY * 3),
      3,
    );
    this.bodyMesh.instanceColor.setUsage(DynamicDrawUsage);
    this.configureMesh(this.bodyMesh, 'pedestrian-bodies');
    this.configureMesh(this.headMesh, 'pedestrian-heads');
    this.group.name = 'pedestrians';
    this.group.add(this.bodyMesh, this.headMesh);
  }

  get count(): number {
    return this.states.size;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    this.updateFrame(this.now());
  }

  /** Newest full pedestrian list; agents absent from it despawn immediately. */
  setPedestrians(list: readonly PedestrianView[]): void {
    if (list.length === 0) {
      this.states.clear();
      this.bodyMesh.count = 0;
      this.headMesh.count = 0;
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
        purpose: pedestrian.purpose,
        motion: retargetVehicleMotion(continuing?.motion, previousAlpha, target),
      });
    }
    this.states = next;
    this.bodyMesh.count = next.size;
    this.headMesh.count = next.size;
    this.applyColors();
    this.updateFrame(now);
  }

  /** Interpolate all active walkers without allocating per-instance objects. */
  updateFrame(now: number): void {
    if (this.states.size === 0) return;
    const alpha = this.presentationAlpha(now);
    let slot = 0;
    for (const state of this.states.values()) {
      const { x, z, yaw } = sampleVehicleMotionInto(state.motion, alpha, MOTION_POSE);
      MATRIX.makeRotationY(yaw).setPosition(
        x,
        this.surface.heightAt(x, z) + PEDESTRIAN_Y,
        z,
      );
      this.bodyMesh.setMatrixAt(slot++, MATRIX);
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;
  }

  private configureMesh(mesh: InstancedMesh, name: string): void {
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  }

  private presentationAlpha(now: number): number {
    return this.lastMessageAt === null
      ? 1
      : Math.min(1, Math.max(0, (now - this.lastMessageAt) / this.messageIntervalMs));
  }

  private sampleSegment(pedestrian: PedestrianView): { x: number; z: number; yaw: number } {
    const ax = (pedestrian.fromCell % this.gridWidth) + 0.5;
    const az = Math.floor(pedestrian.fromCell / this.gridWidth) + 0.5;
    const bx = (pedestrian.toCell % this.gridWidth) + 0.5;
    const bz = Math.floor(pedestrian.toCell / this.gridWidth) + 0.5;
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    const t = Math.min(1, Math.max(0, pedestrian.t));
    if (length === 0) return { x: ax, z: az, yaw: 0 };
    return {
      x: ax + dx * t + (dz / length) * PEDESTRIAN_CURB_OFFSET,
      z: az + dz * t - (dx / length) * PEDESTRIAN_CURB_OFFSET,
      yaw: Math.atan2(dx, dz),
    };
  }

  private applyColors(): void {
    let slot = 0;
    for (const state of this.states.values()) {
      this.bodyMesh.setColorAt(
        slot++,
        COLOR.setHex(PEDESTRIAN_PURPOSE_COLORS[state.purpose]),
      );
    }
    this.bodyMesh.instanceColor!.needsUpdate = true;
  }
}
