import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial } from 'three';
import { ZONE_COLORS, ZONE_SURFACE_Y, ZONE_TINT_OPACITY, type ZoneKind } from './constants';

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
  readonly mesh: Mesh;
  private cells: readonly ZoneCellView[] = [];
  private occludedCells: ReadonlySet<number> = new Set();
  private dirty = false;

  constructor(private readonly gridWidth: number) {
    this.mesh = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: ZONE_TINT_OPACITY,
        depthWrite: false,
      }),
    );
    this.mesh.name = 'zones';
    this.mesh.visible = false;
  }

  /** Full zoned-cell set from a `zones` message (bulk, infrequent). */
  setZones(cells: readonly ZoneCellView[]): void {
    this.cells = cells;
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
    const color = new Color();
    const y = ZONE_SURFACE_Y;

    for (let i = 0; i < visible.length; i++) {
      const x = visible[i].i % this.gridWidth;
      const z = Math.floor(visible[i].i / this.gridWidth);
      positions.set([x, y, z, x + 1, y, z, x, y, z + 1, x + 1, y, z + 1], i * 12);
      color.setHex(ZONE_COLORS[visible[i].zone]);
      for (let n = 0; n < 4; n++) colors.set([color.r, color.g, color.b], i * 12 + n * 3);
      const base = i * 4;
      indices.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], i * 6);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));

    const old = this.mesh.geometry;
    this.mesh.geometry = geometry;
    old.dispose();
    this.mesh.visible = visible.length > 0;
  }
}
