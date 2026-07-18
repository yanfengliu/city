import { BufferGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { GeometryBuilder } from './geometry-builder';
import { addServiceStructure } from './service-structures';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';
import type { ServiceKind } from './constants';

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

const SERVICE_KINDS: readonly ServiceKind[] = ['fireStation', 'police', 'clinic', 'school'];

/**
 * Player-placed service buildings as one merged low-poly model mesh per
 * service kind (fire station, police station, clinic, school), built from the
 * shared GeometryBuilder like the utility structures. A kind's mesh rebuilds
 * whenever any structure of that kind changes; rebuilds iterate views sorted
 * by id, so output is byte-identical for identical inputs regardless of
 * upsert order. Shadow-map invalidation stays with the existing
 * occupancy-flush path in the app layer — no calls from here.
 */
export class StructuresView {
  readonly group = new Group();
  private readonly material = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  private readonly meshes: Record<ServiceKind, Mesh>;
  private readonly views = new Map<number, StructureRenderView>();
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor() {
    this.group.name = 'structures';
    this.meshes = Object.fromEntries(
      SERVICE_KINDS.map((kind) => [kind, this.makeMesh(kind)]),
    ) as Record<ServiceKind, Mesh>;
  }

  get count(): number {
    return this.views.size;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    this.rebuild(SERVICE_KINDS);
  }

  upsert(view: StructureRenderView): void {
    const previous = this.views.get(view.id);
    this.views.set(view.id, view);
    // Defensive: a structure's service never changes, but if it did, the old
    // kind's mesh must drop it too.
    this.rebuild(
      previous && previous.service !== view.service
        ? [previous.service, view.service]
        : [view.service],
    );
  }

  /** Tolerates unknown ids during defensive rebuild or full-sync reconciliation. */
  remove(id: number): void {
    const previous = this.views.get(id);
    if (!previous) return;
    this.views.delete(id);
    this.rebuild([previous.service]);
  }

  /** Empty merged mesh for one service kind; geometry swaps in on rebuild. */
  private makeMesh(kind: ServiceKind): Mesh {
    const mesh = new Mesh(new BufferGeometry(), this.material);
    mesh.name = `${kind}-model`;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private rebuild(kinds: readonly ServiceKind[]): void {
    for (const kind of kinds) {
      const builder = new GeometryBuilder();
      const views = [...this.views.values()]
        .filter((view) => view.service === kind)
        .sort((a, b) => a.id - b.id);
      for (const view of views) addServiceStructure(builder, this.surface, view);
      this.swapGeometry(this.meshes[kind], builder.build());
    }
  }

  private swapGeometry(mesh: Mesh, geometry: BufferGeometry): void {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old.dispose();
    const positions = geometry.getAttribute('position');
    mesh.visible = positions !== undefined && positions.count > 0;
  }
}
