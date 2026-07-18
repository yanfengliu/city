import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  VEHICLE_BODY_HEIGHT,
  VEHICLE_BODY_LENGTH,
  VEHICLE_BODY_WIDTH,
  VEHICLE_CAPACITY,
  VEHICLE_LERP_DEFAULT_MS,
  VEHICLE_LERP_MAX_MS,
  VEHICLE_LERP_MIN_MS,
  VEHICLE_ROOF_HEIGHT,
  VEHICLE_ROOF_LENGTH,
  VEHICLE_ROOF_WIDTH,
  VEHICLE_Y,
} from './constants';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';
import {
  VEHICLE_LANE_OFFSET,
  vehicleAppearance,
  type VehicleAppearance,
} from './vehicle-style';
import {
  retargetVehicleMotion,
  sampleVehicleMotionInto,
  type VehicleMotionSegment,
} from './vehicle-motion';

/** Plain-data vehicle view (mirrors the protocol VehicleView). */
export interface VehicleRenderView {
  id: number;
  generation: number;
  edge: number;
  /** Progress along the edge in [0,1). */
  t: number;
  /** Traversing the edge's cell array back-to-front. */
  reverse: boolean;
}

/** Plain-data road edge (mirrors the protocol RoadEdgePayload; cells are cell indices a → b). */
export interface RoadEdgeView {
  id: number;
  cells: number[];
}

interface VehicleState {
  generation: number;
  motion: VehicleMotionSegment;
  appearance: VehicleAppearance;
}

const MATRIX = new Matrix4();
const MOTION_POSE = { x: 0, z: 0, yaw: 0 };
const COLOR = new Color();
const SCALE = new Vector3();

/**
 * Vehicles as one InstancedMesh of low-poly cars (body + roof). The sim sends
 * (edge, t, reverse) at tick rate; positions are sampled from the edge's cell
 * polyline and the renderer lerps each car from its previous sampled position
 * to the newest one over the observed message spacing (renderer-owned
 * smoothing). Road graphs are kept per topologyVersion until no vehicle
 * message references them, so cars never sample a graph they aren't on.
 * Instance color = the congestion bucket of the car's edge (speed proxy).
 */
export class VehiclesView {
  readonly mesh: InstancedMesh;
  /** topologyVersion → edge id → polyline cell indices. */
  private readonly graphs = new Map<number, Map<number, readonly number[]>>();
  /** Insertion order doubles as the instance slot order for colors + matrices. */
  private states = new Map<number, VehicleState>();
  /** Vehicles message that arrived before its topologyVersion's roads message. */
  private pending: { version: number; list: VehicleRenderView[] } | null = null;
  private lastMessageAt: number | null = null;
  private messageIntervalMs = VEHICLE_LERP_DEFAULT_MS;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor(
    private readonly gridWidth: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    const body = new BoxGeometry(VEHICLE_BODY_WIDTH, VEHICLE_BODY_HEIGHT, VEHICLE_BODY_LENGTH)
      .translate(0, VEHICLE_BODY_HEIGHT / 2, 0);
    const roof = new BoxGeometry(VEHICLE_ROOF_WIDTH, VEHICLE_ROOF_HEIGHT, VEHICLE_ROOF_LENGTH)
      .translate(0, VEHICLE_BODY_HEIGHT + VEHICLE_ROOF_HEIGHT / 2, -VEHICLE_BODY_LENGTH * 0.08);
    const geometry = mergeGeometries([body, roof]);
    body.dispose();
    roof.dispose();
    this.mesh = new InstancedMesh(geometry, new MeshLambertMaterial({ color: 0xffffff }), VEHICLE_CAPACITY);
    this.mesh.name = 'vehicles';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(VEHICLE_CAPACITY * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
  }

  /** Live vehicle count from the newest applied message. */
  get count(): number {
    return this.states.size;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    this.updateFrame(this.now());
  }

  /** Registers a `roads` message's edge geometry under its topologyVersion. */
  setRoads(topologyVersion: number, edges: readonly RoadEdgeView[]): void {
    this.graphs.set(topologyVersion, new Map(edges.map((edge) => [edge.id, edge.cells])));
    if (this.pending?.version === topologyVersion) {
      const { version, list } = this.pending;
      this.pending = null;
      this.apply(version, list);
    } else if (this.states.size === 0 && !this.pending) {
      // Nothing references older graphs; keep only the newest.
      for (const version of this.graphs.keys()) {
        if (version !== topologyVersion) this.graphs.delete(version);
      }
    }
  }

  /** Newest vehicles message; vehicles absent from it despawn. */
  setVehicles(topologyVersion: number, list: VehicleRenderView[]): void {
    if (!this.graphs.has(topologyVersion)) {
      // Roads message for this version is still in flight (worker posts vehicles first).
      this.pending = { version: topologyVersion, list };
      return;
    }
    this.pending = null;
    this.apply(topologyVersion, list);
  }

  /** Per-render-frame smoothing: lerp each car from its previous to newest sampled position. */
  updateFrame(now: number): void {
    if (this.states.size === 0) return;
    const alpha =
      this.lastMessageAt === null
        ? 1
        : Math.min(1, Math.max(0, (now - this.lastMessageAt) / this.messageIntervalMs));
    let slot = 0;
    for (const state of this.states.values()) {
      const { x, z, yaw } = sampleVehicleMotionInto(state.motion, alpha, MOTION_POSE);
      const look = state.appearance;
      MATRIX.makeRotationY(yaw)
        .scale(SCALE.set(look.widthScale, look.heightScale, look.lengthScale))
        .setPosition(x, this.surface.heightAt(x, z) + VEHICLE_Y, z);
      this.mesh.setMatrixAt(slot++, MATRIX);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private apply(topologyVersion: number, list: VehicleRenderView[]): void {
    const now = this.now();
    const previousAlpha =
      this.lastMessageAt === null
        ? 1
        : Math.min(1, Math.max(0, (now - this.lastMessageAt) / this.messageIntervalMs));
    if (this.lastMessageAt !== null) {
      this.messageIntervalMs = Math.min(
        Math.max(now - this.lastMessageAt, VEHICLE_LERP_MIN_MS),
        VEHICLE_LERP_MAX_MS,
      );
    }
    this.lastMessageAt = now;

    const graph = this.graphs.get(topologyVersion);
    const next = new Map<number, VehicleState>();
    for (const vehicle of list) {
      if (next.size === VEHICLE_CAPACITY) break;
      const cells = graph?.get(vehicle.edge);
      if (!cells || cells.length === 0) continue;
      const { x, z, yaw } = this.samplePolyline(cells, vehicle.t, vehicle.reverse);
      const previous = this.states.get(vehicle.id);
      const continuing = previous?.generation === vehicle.generation
        ? previous
        : undefined;
      next.set(vehicle.id, {
        generation: vehicle.generation,
        motion: retargetVehicleMotion(continuing?.motion, previousAlpha, { x, z, yaw }),
        appearance: continuing?.appearance ?? vehicleAppearance(vehicle.id, vehicle.generation),
      });
    }
    this.states = next;
    // Older topologies can no longer be referenced (versions are monotonic).
    for (const version of this.graphs.keys()) {
      if (version < topologyVersion) this.graphs.delete(version);
    }
    this.mesh.count = next.size;
    this.applyColors();
    this.updateFrame(now);
  }

  /**
   * World position + heading at fractional progress t along the edge polyline,
   * shifted onto the right-hand lane of the travel direction so opposing
   * flows occupy separate carriageways. Segments are unit-length (grid
   * cells), so reverse traversal samples the polyline at (1 - t) with the
   * direction negated.
   */
  private samplePolyline(
    cells: readonly number[],
    t: number,
    reverse: boolean,
  ): { x: number; z: number; yaw: number } {
    const centerX = (index: number): number => (index % this.gridWidth) + 0.5;
    const centerZ = (index: number): number => Math.floor(index / this.gridWidth) + 0.5;
    if (cells.length === 1) return { x: centerX(cells[0]), z: centerZ(cells[0]), yaw: 0 };
    const progress = reverse ? 1 - t : t;
    const s = Math.min(Math.max(progress, 0), 1) * (cells.length - 1);
    const i = Math.min(Math.floor(s), cells.length - 2);
    const f = s - i;
    const ax = centerX(cells[i]);
    const az = centerZ(cells[i]);
    const bx = centerX(cells[i + 1]);
    const bz = centerZ(cells[i + 1]);
    const sign = reverse ? -1 : 1;
    // Unit travel direction; its clockwise perpendicular is travel-right.
    const dx = (bx - ax) * sign;
    const dz = (bz - az) * sign;
    return {
      x: ax + (bx - ax) * f - dz * VEHICLE_LANE_OFFSET,
      z: az + (bz - az) * f + dx * VEHICLE_LANE_OFFSET,
      yaw: Math.atan2(dx, dz),
    };
  }

  private applyColors(): void {
    let slot = 0;
    for (const state of this.states.values()) {
      this.mesh.setColorAt(slot++, COLOR.setHex(state.appearance.paint));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
