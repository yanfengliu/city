import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
} from 'three';
import { signalPhase, type SignalPhase } from '../protocol/signal-phase';
import {
  TRAFFIC_SIGNAL_ACTIVE_GREEN,
  TRAFFIC_SIGNAL_ACTIVE_RED,
  TRAFFIC_SIGNAL_DIM_AMBER,
  TRAFFIC_SIGNAL_INACTIVE_GREEN,
  TRAFFIC_SIGNAL_INACTIVE_RED,
  TRAFFIC_SIGNAL_LENS_DEPTH,
  TRAFFIC_SIGNAL_LENS_HALF_SIZE,
} from './road-streetscape-style';
import type { SignalLensDescriptor } from './road-streetscape';

const MATRIX = new Matrix4();
const COLOR = new Color();

function lensColor(descriptor: SignalLensDescriptor, phase: SignalPhase): number {
  const green = phase === descriptor.axis;
  if (descriptor.slot === 0) return green ? TRAFFIC_SIGNAL_INACTIVE_RED : TRAFFIC_SIGNAL_ACTIVE_RED;
  if (descriptor.slot === 1) return TRAFFIC_SIGNAL_DIM_AMBER;
  return green ? TRAFFIC_SIGNAL_ACTIVE_GREEN : TRAFFIC_SIGNAL_INACTIVE_GREEN;
}

/**
 * Live traffic-light faces: one instanced box per lens, recolored from the
 * shared `signalPhase(tick, node)` the sim also obeys — the renderer can
 * therefore never show green to a queue the sim is holding at the line. The
 * streetscape's merged mesh keeps the static pole/housing; lens transforms
 * rebuild only when the road network does, colors only when a junction's
 * phase actually changes. Unlit material so the lights read day and night.
 */
export class SignalLensesView {
  readonly group = new Group();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly material = new MeshBasicMaterial({ color: 0xffffff });
  private mesh: InstancedMesh | null = null;
  private descriptors: SignalLensDescriptor[] = [];
  private readonly lastPhase = new Map<number, SignalPhase>();
  private lastTick = 0;

  constructor() {
    this.group.name = 'traffic-signal-lenses';
  }

  /** Number of live lens instances (automation/test hook). */
  get count(): number {
    return this.descriptors.length;
  }

  /** Rebuilds instances for a new road network's lens layout. */
  setLenses(descriptors: readonly SignalLensDescriptor[]): void {
    this.descriptors = [...descriptors];
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.lastPhase.clear();
    if (this.descriptors.length === 0) return;

    const mesh = new InstancedMesh(this.geometry, this.material, this.descriptors.length);
    mesh.name = 'traffic-signal-lens-instances';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(this.descriptors.length * 3),
      3,
    );
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    const half = TRAFFIC_SIGNAL_LENS_HALF_SIZE;
    const depth = TRAFFIC_SIGNAL_LENS_DEPTH;
    this.descriptors.forEach((lens, slot) => {
      const horizontal = lens.arm === 'w' || lens.arm === 'e';
      MATRIX.makeScale(
        horizontal ? depth * 2 : half * 2,
        half * 2,
        horizontal ? half * 2 : depth * 2,
      ).setPosition(lens.x, lens.y, lens.z);
      mesh.setMatrixAt(slot, MATRIX);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.mesh = mesh;
    this.group.add(mesh);
    this.recolor(this.lastTick, true);
  }

  /** Recolors lenses whose junction phase changed at this sim tick. */
  updateTick(tick: number): void {
    this.lastTick = tick;
    if (this.mesh) this.recolor(tick, false);
  }

  private recolor(tick: number, force: boolean): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const changed = new Set<number>();
    for (const lens of this.descriptors) {
      if (changed.has(lens.node)) continue;
      const phase = signalPhase(tick, lens.node);
      if (force || this.lastPhase.get(lens.node) !== phase) {
        changed.add(lens.node);
        this.lastPhase.set(lens.node, phase);
      }
    }
    if (changed.size === 0) return;
    this.descriptors.forEach((lens, slot) => {
      if (!changed.has(lens.node)) return;
      const phase = this.lastPhase.get(lens.node);
      if (phase === undefined) return;
      mesh.setColorAt(slot, COLOR.setHex(lensColor(lens, phase)));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
