import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  VEHICLE_BODY_HEIGHT,
  VEHICLE_BODY_LENGTH,
  VEHICLE_BODY_WIDTH,
  VEHICLE_BUCKET_COLORS,
  VEHICLE_CAPACITY,
  VEHICLE_LERP_DEFAULT_MS,
  VEHICLE_LERP_MAX_MS,
  VEHICLE_LERP_MIN_MS,
  VEHICLE_ROOF_HEIGHT,
  VEHICLE_ROOF_LENGTH,
  VEHICLE_ROOF_WIDTH,
  VEHICLE_Y,
} from './constants';

/** Plain-data vehicle view (mirrors the protocol VehicleView). */
export interface VehicleRenderView {
  id: number;
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
  edge: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  yaw: number;
}

const MATRIX = new Matrix4();
const COLOR = new Color();

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
  private buckets: ReadonlyMap<number, number> = new Map();
  private lastMessageAt = 0;
  private messageIntervalMs = VEHICLE_LERP_DEFAULT_MS;

  constructor(private readonly gridWidth: number) {
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

  /** Congestion buckets by edge id; recolors live instances immediately. */
  setTraffic(buckets: ReadonlyMap<number, number>): void {
    this.buckets = buckets;
    this.applyColors();
  }

  /** Per-render-frame smoothing: lerp each car from its previous to newest sampled position. */
  updateFrame(now: number): void {
    if (this.states.size === 0) return;
    const alpha = Math.min(1, (now - this.lastMessageAt) / this.messageIntervalMs);
    let slot = 0;
    for (const state of this.states.values()) {
      const x = state.fromX + (state.toX - state.fromX) * alpha;
      const z = state.fromZ + (state.toZ - state.fromZ) * alpha;
      MATRIX.makeRotationY(state.yaw).setPosition(x, VEHICLE_Y, z);
      this.mesh.setMatrixAt(slot++, MATRIX);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private apply(topologyVersion: number, list: VehicleRenderView[]): void {
    const now = performance.now();
    if (this.lastMessageAt > 0) {
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
      next.set(vehicle.id, {
        edge: vehicle.edge,
        fromX: previous ? previous.toX : x,
        fromZ: previous ? previous.toZ : z,
        toX: x,
        toZ: z,
        yaw,
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
   * World position + heading at fractional progress t along the edge polyline.
   * Segments are unit-length (grid cells), so reverse traversal samples the
   * polyline at (1 - t) with the direction negated.
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
    return {
      x: ax + (bx - ax) * f,
      z: az + (bz - az) * f,
      yaw: Math.atan2((bx - ax) * sign, (bz - az) * sign),
    };
  }

  private applyColors(): void {
    let slot = 0;
    for (const state of this.states.values()) {
      const bucket = Math.min(this.buckets.get(state.edge) ?? 0, VEHICLE_BUCKET_COLORS.length - 1);
      this.mesh.setColorAt(slot++, COLOR.setHex(VEHICLE_BUCKET_COLORS[bucket]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
