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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PedestrianPurpose, PedestrianView } from '../protocol/messages';
import {
  PEDESTRIAN_BODY,
  PEDESTRIAN_CAPACITY,
  PEDESTRIAN_CURB_OFFSET,
  PEDESTRIAN_HEAD,
  PEDESTRIAN_LEG,
  VEHICLE_LERP_DEFAULT_MS,
  VEHICLE_LERP_MAX_MS,
  VEHICLE_LERP_MIN_MS,
} from './constants';
import {
  PEDESTRIAN_Y,
  pedestrianStyle,
  type PedestrianStyle,
} from './pedestrian-style';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';
import {
  retargetVehicleMotion,
  sampleVehicleMotionInto,
  type VehicleMotionSegment,
} from './vehicle-motion';

interface PedestrianState {
  generation: number;
  purpose: PedestrianPurpose;
  style: PedestrianStyle;
  motion: VehicleMotionSegment;
}

const MATRIX = new Matrix4();
const SCALE = new Vector3();
const MOTION_POSE = { x: 0, z: 0, yaw: 0 };
const COLOR = new Color();

/**
 * Visible purposeful trips as fixed-capacity low-poly people. Tops, bottoms,
 * and heads share one instance transform buffer, so per-frame interpolation
 * writes each pose once. Deterministic identity styling keeps purpose-readable
 * top palettes while varying clothes, skin tone, height, and build.
 */
export class PedestriansView {
  readonly group = new Group();
  readonly topMesh: InstancedMesh;
  readonly bottomMesh: InstancedMesh;
  readonly headMesh: InstancedMesh;
  private states = new Map<number, PedestrianState>();
  private lastMessageAt: number | null = null;
  private messageIntervalMs = VEHICLE_LERP_DEFAULT_MS;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor(
    private readonly gridWidth: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    const topGeometry = new BoxGeometry(
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
    const bottomGeometry = mergeGeometries([leftLeg, rightLeg]);
    leftLeg.dispose();
    rightLeg.dispose();

    const head = new OctahedronGeometry(PEDESTRIAN_HEAD.radius, 0)
      .translate(0, PEDESTRIAN_HEAD.y, 0);
    const nose = new OctahedronGeometry(0.022, 0)
      .scale(0.7, 0.7, 1)
      .translate(0, PEDESTRIAN_HEAD.y, PEDESTRIAN_HEAD.radius + 0.012);
    const headGeometry = mergeGeometries([head, nose]);
    head.dispose();
    nose.dispose();

    this.topMesh = new InstancedMesh(
      topGeometry,
      new MeshLambertMaterial({ color: 0xffffff }),
      PEDESTRIAN_CAPACITY,
    );
    this.bottomMesh = new InstancedMesh(
      bottomGeometry,
      new MeshLambertMaterial({ color: 0xffffff }),
      PEDESTRIAN_CAPACITY,
    );
    this.headMesh = new InstancedMesh(
      headGeometry,
      new MeshLambertMaterial({ color: 0xffffff }),
      PEDESTRIAN_CAPACITY,
    );
    this.topMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bottomMesh.instanceMatrix = this.topMesh.instanceMatrix;
    this.headMesh.instanceMatrix = this.topMesh.instanceMatrix;
    this.addColorBuffer(this.topMesh);
    this.addColorBuffer(this.bottomMesh);
    this.addColorBuffer(this.headMesh);
    this.configureMesh(this.topMesh, 'pedestrian-tops');
    this.configureMesh(this.bottomMesh, 'pedestrian-bottoms');
    this.configureMesh(this.headMesh, 'pedestrian-heads');
    this.group.name = 'pedestrians';
    this.group.add(this.topMesh, this.bottomMesh, this.headMesh);
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
      this.topMesh.count = 0;
      this.bottomMesh.count = 0;
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
        style: pedestrianStyle(pedestrian.id, pedestrian.generation, pedestrian.purpose),
        motion: retargetVehicleMotion(continuing?.motion, previousAlpha, target),
      });
    }
    this.states = next;
    this.topMesh.count = next.size;
    this.bottomMesh.count = next.size;
    this.headMesh.count = next.size;
    this.applyStyles();
    this.updateFrame(now);
  }

  /** Interpolate all active walkers without allocating per-instance objects. */
  updateFrame(now: number): void {
    if (this.states.size === 0) return;
    const alpha = this.presentationAlpha(now);
    let slot = 0;
    for (const state of this.states.values()) {
      const { x, z, yaw } = sampleVehicleMotionInto(state.motion, alpha, MOTION_POSE);
      MATRIX.makeRotationY(yaw).scale(
        SCALE.set(state.style.widthScale, state.style.heightScale, state.style.widthScale),
      ).setPosition(
        x,
        this.surface.heightAt(x, z) + PEDESTRIAN_Y,
        z,
      );
      this.topMesh.setMatrixAt(slot++, MATRIX);
    }
    this.topMesh.instanceMatrix.needsUpdate = true;
  }

  private addColorBuffer(mesh: InstancedMesh): void {
    mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(PEDESTRIAN_CAPACITY * 3),
      3,
    );
    mesh.instanceColor.setUsage(DynamicDrawUsage);
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

  private applyStyles(): void {
    let slot = 0;
    for (const state of this.states.values()) {
      this.topMesh.setColorAt(slot, COLOR.setHex(state.style.topColor));
      this.bottomMesh.setColorAt(slot, COLOR.setHex(state.style.bottomColor));
      this.headMesh.setColorAt(slot, COLOR.setHex(state.style.skinColor));
      slot++;
    }
    this.topMesh.instanceColor!.needsUpdate = true;
    this.bottomMesh.instanceColor!.needsUpdate = true;
    this.headMesh.instanceColor!.needsUpdate = true;
  }
}
