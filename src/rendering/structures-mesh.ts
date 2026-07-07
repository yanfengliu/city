import {
  BoxGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
} from 'three';
import type { BufferGeometry, Material } from 'three';
import {
  STRUCTURE_DETAIL_COLORS,
  STRUCTURE_DETAIL_HEIGHT,
  STRUCTURE_DETAIL_LENGTH,
  STRUCTURE_DETAIL_WIDTH,
  STRUCTURE_FOOTPRINT_MARGIN,
  STRUCTURE_ROOF_COLORS,
  STRUCTURE_ROOF_HEIGHT,
  STRUCTURE_START_CAPACITY,
  STRUCTURE_WALL_COLORS,
  STRUCTURE_WALL_HEIGHT,
  type ServiceKind,
} from './constants';

/** Plain-data service structure view (structurally mirrors the protocol StructureView). */
export interface StructureRenderView {
  id: number;
  /** Footprint anchor (top-left cell) and size in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  service: ServiceKind;
}

interface Archetype {
  walls: InstancedMesh;
  roofs: InstancedMesh;
  details: InstancedMesh;
  /** Structure id per instance slot (parallel to the instance buffers). */
  ids: number[];
  capacity: number;
}

const SERVICE_KINDS: readonly ServiceKind[] = ['fireStation', 'police', 'clinic', 'school'];
const MATRIX = new Matrix4();

/**
 * Player-placed service buildings as instanced walls + roofs + roof details,
 * one archetype per service type (distinct palettes so they read against RCI
 * buildings; taller than a level-1 growable). Same slot layout / swap-remove
 * bookkeeping as BuildingsView, minus per-instance colors — the type's
 * materials carry the palette.
 */
export class StructuresView {
  readonly group = new Group();
  private readonly archetypes: Record<ServiceKind, Archetype>;
  private readonly slots = new Map<number, { service: ServiceKind; slot: number }>();
  private readonly unitBox: BufferGeometry;
  private readonly detailBox: BufferGeometry;

  constructor() {
    this.group.name = 'structures';
    // Base at y=0; per-instance matrices scale to footprint * margin and fixed heights.
    this.unitBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.detailBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.archetypes = Object.fromEntries(
      SERVICE_KINDS.map((kind) => [kind, this.makeArchetype(kind)]),
    ) as Record<ServiceKind, Archetype>;
  }

  get count(): number {
    return this.slots.size;
  }

  upsert(view: StructureRenderView): void {
    const existing = this.slots.get(view.id);
    if (existing && existing.service !== view.service) this.remove(view.id); // defensive: type never changes
    const current = this.slots.get(view.id);
    const archetype = this.archetypes[view.service];
    if (current) {
      this.writeInstance(archetype, current.slot, view);
      return;
    }
    if (archetype.ids.length === archetype.capacity) this.grow(archetype);
    const slot = archetype.ids.length;
    archetype.ids.push(view.id);
    this.slots.set(view.id, { service: view.service, slot });
    archetype.walls.count = archetype.ids.length;
    archetype.roofs.count = archetype.ids.length;
    archetype.details.count = archetype.ids.length;
    this.writeInstance(archetype, slot, view);
  }

  /** Tolerates unknown ids — callers may pass the sim's full removal stream. */
  remove(id: number): void {
    const entry = this.slots.get(id);
    if (!entry) return;
    this.slots.delete(id);
    const archetype = this.archetypes[entry.service];
    const last = archetype.ids.length - 1;
    if (entry.slot !== last) {
      const movedId = archetype.ids[last];
      for (const mesh of [archetype.walls, archetype.roofs, archetype.details]) {
        mesh.getMatrixAt(last, MATRIX);
        mesh.setMatrixAt(entry.slot, MATRIX);
        mesh.instanceMatrix.needsUpdate = true;
      }
      archetype.ids[entry.slot] = movedId;
      this.slots.set(movedId, { service: entry.service, slot: entry.slot });
    }
    archetype.ids.pop();
    archetype.walls.count = archetype.ids.length;
    archetype.roofs.count = archetype.ids.length;
    archetype.details.count = archetype.ids.length;
  }

  private makeArchetype(kind: ServiceKind): Archetype {
    return {
      walls: this.makeMesh(
        `${kind}-walls`,
        this.unitBox,
        new MeshLambertMaterial({ color: STRUCTURE_WALL_COLORS[kind] }),
      ),
      roofs: this.makeMesh(
        `${kind}-roofs`,
        this.unitBox,
        new MeshLambertMaterial({ color: STRUCTURE_ROOF_COLORS[kind] }),
      ),
      details: this.makeMesh(
        `${kind}-details`,
        this.detailBox,
        new MeshLambertMaterial({ color: STRUCTURE_DETAIL_COLORS[kind] }),
      ),
      ids: [],
      capacity: STRUCTURE_START_CAPACITY,
    };
  }

  private makeMesh(
    name: string,
    geometry: BufferGeometry,
    material: Material,
    capacity = STRUCTURE_START_CAPACITY,
  ): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }

  private grow(archetype: Archetype): void {
    archetype.capacity *= 2;
    archetype.walls = this.replaceMesh(archetype.walls, archetype.capacity);
    archetype.roofs = this.replaceMesh(archetype.roofs, archetype.capacity);
    archetype.details = this.replaceMesh(archetype.details, archetype.capacity);
  }

  private replaceMesh(old: InstancedMesh, capacity: number): InstancedMesh {
    const next = this.makeMesh(old.name, old.geometry, old.material as Material, capacity);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    next.count = old.count;
    next.instanceMatrix.needsUpdate = true;
    this.group.remove(old);
    old.dispose();
    return next;
  }

  private writeInstance(archetype: Archetype, slot: number, view: StructureRenderView): void {
    const cx = view.x + view.w / 2;
    const cz = view.y + view.h / 2;
    const sx = view.w * STRUCTURE_FOOTPRINT_MARGIN;
    const sz = view.h * STRUCTURE_FOOTPRINT_MARGIN;
    MATRIX.makeScale(sx, STRUCTURE_WALL_HEIGHT, sz).setPosition(cx, 0, cz);
    archetype.walls.setMatrixAt(slot, MATRIX);
    MATRIX.makeScale(sx, STRUCTURE_ROOF_HEIGHT, sz).setPosition(cx, STRUCTURE_WALL_HEIGHT, cz);
    archetype.roofs.setMatrixAt(slot, MATRIX);
    const detailLength = Math.min(STRUCTURE_DETAIL_LENGTH, sx * 0.55);
    const detailWidth = Math.min(STRUCTURE_DETAIL_WIDTH, sz * 0.35);
    MATRIX.makeScale(detailLength, STRUCTURE_DETAIL_HEIGHT, detailWidth).setPosition(
      cx,
      STRUCTURE_WALL_HEIGHT + STRUCTURE_ROOF_HEIGHT,
      cz,
    );
    archetype.details.setMatrixAt(slot, MATRIX);
    for (const mesh of [archetype.walls, archetype.roofs, archetype.details]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
