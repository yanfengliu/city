import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial } from 'three';
import {
  ZONE_COLORS,
  ZONE_GROUND_DETAIL_COLORS,
  ZONE_GROUND_DETAIL_INSET,
  ZONE_GROUND_DETAIL_OPACITY,
  ZONE_GROUND_DETAIL_Y,
  ZONE_SURFACE_Y,
  ZONE_TINT_OPACITY,
  type ZoneKind,
} from './constants';
import { buildSurfacePatch, writeSurfaceQuad } from './surface-geometry';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

/** Plain-data zoned cell (mirrors the protocol `zones` message payload). */
export interface ZoneCellView {
  /** Cell index = y * gridWidth + x. */
  i: number;
  zone: ZoneKind;
}

/**
 * Zoned cells as one merged mesh of translucent vertex-colored quads slightly
 * above the terrain (below roads). Cells covered by a building footprint are
 * skipped so tint only shows on undeveloped zoned cells. Zone and building
 * updates just mark the view dirty; the composition root calls flushIfDirty()
 * once per frame, so bursts of building diffs cost one rebuild.
 */
export class ZonesView {
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly detailMesh: Mesh;
  private cells: readonly ZoneCellView[] = [];
  private occludedCells: ReadonlySet<number> = new Set();
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
  private dirty = false;

  constructor(private readonly gridWidth: number) {
    this.group.name = 'zones';
    this.mesh = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: ZONE_TINT_OPACITY,
        depthWrite: false,
      }),
    );
    this.mesh.name = 'zone-tint';
    this.detailMesh = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: ZONE_GROUND_DETAIL_OPACITY,
        depthWrite: false,
      }),
    );
    this.detailMesh.name = 'zone-ground-details';
    this.mesh.visible = false;
    this.detailMesh.visible = false;
    this.group.add(this.mesh, this.detailMesh);
  }

  /** Full zoned-cell set from a `zones` message (bulk, infrequent). */
  setZones(cells: readonly ZoneCellView[]): void {
    this.cells = cells;
    this.dirty = true;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    this.dirty = true;
  }

  /** Cells hidden under building footprints. */
  setOccludedCells(cells: ReadonlySet<number>): void {
    this.occludedCells = cells;
    this.dirty = true;
  }

  flushIfDirty(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild();
  }

  private rebuild(): void {
    const visible = this.cells.filter((cell) => !this.occludedCells.has(cell.i));
    const positions = new Float32Array(visible.length * 12);
    const colors = new Float32Array(visible.length * 12);
    const indices = new Uint32Array(visible.length * 6);
    const detailPositions: number[] = [];
    const detailColors: number[] = [];
    const detailIndices: number[] = [];
    const color = new Color();
    const y = ZONE_SURFACE_Y;
    const detailY = ZONE_GROUND_DETAIL_Y;
    const inset = ZONE_GROUND_DETAIL_INSET;

    for (let i = 0; i < visible.length; i++) {
      const x = visible[i].i % this.gridWidth;
      const z = Math.floor(visible[i].i / this.gridWidth);
      writeSurfaceQuad(positions, i * 12, this.surface, x, z, x + 1, z + 1, y);
      color.setHex(ZONE_COLORS[visible[i].zone]);
      for (let n = 0; n < 4; n++) colors.set([color.r, color.g, color.b], i * 12 + n * 3);
      const base = i * 4;
      indices.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], i * 6);

      const patch = buildSurfacePatch(
        this.surface,
        x + inset,
        z + inset,
        x + 1 - inset,
        z + 1 - inset,
        detailY,
      );
      const detailBase = detailPositions.length / 3;
      detailPositions.push(...patch.positions);
      color.setHex(ZONE_GROUND_DETAIL_COLORS[visible[i].zone]);
      for (let n = 0; n < patch.positions.length / 3; n++) {
        detailColors.push(color.r, color.g, color.b);
      }
      for (const index of patch.indices) detailIndices.push(detailBase + index);
    }

    this.replaceGeometry(this.mesh, positions, colors, indices);
    this.replaceGeometry(
      this.detailMesh,
      new Float32Array(detailPositions),
      new Float32Array(detailColors),
      new Uint32Array(detailIndices),
    );
    this.mesh.visible = visible.length > 0;
    this.detailMesh.visible = visible.length > 0;
  }

  private replaceGeometry(
    mesh: Mesh,
    positions: Float32Array,
    colors: Float32Array,
    indices: Uint32Array,
  ): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old.dispose();
  }
}
