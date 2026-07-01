import { BufferAttribute, BufferGeometry, Mesh, MeshLambertMaterial } from 'three';
import { ROAD_COLOR, ROAD_SURFACE_Y } from './constants';

/**
 * Road cells as one merged mesh of flat asphalt quads slightly above the
 * terrain. Fully rebuilt from each `roads` message — cheap at Phase 1 scale
 * (chunked rebuilds come later).
 */
export class RoadsView {
  readonly mesh: Mesh;
  private readonly gridWidth: number;
  /** Road cell count from the last update, for automation/text state. */
  cellCount = 0;

  constructor(gridWidth: number) {
    this.gridWidth = gridWidth;
    this.mesh = new Mesh(new BufferGeometry(), new MeshLambertMaterial({ color: ROAD_COLOR }));
    this.mesh.name = 'roads';
    this.mesh.visible = false;
  }

  /** Rebuilds the merged geometry from road cell indices (index = y * width + x). */
  update(cells: readonly number[]): void {
    this.cellCount = cells.length;
    const positions = new Float32Array(cells.length * 12);
    const normals = new Float32Array(cells.length * 12);
    const indices = new Uint32Array(cells.length * 6);
    const y = ROAD_SURFACE_Y;

    for (let i = 0; i < cells.length; i++) {
      const x = cells[i] % this.gridWidth;
      const z = Math.floor(cells[i] / this.gridWidth);
      positions.set(
        [x, y, z, x + 1, y, z, x, y, z + 1, x + 1, y, z + 1],
        i * 12,
      );
      for (let n = 0; n < 4; n++) normals.set([0, 1, 0], i * 12 + n * 3);
      const base = i * 4;
      indices.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], i * 6);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));

    const old = this.mesh.geometry;
    this.mesh.geometry = geometry;
    old.dispose();
    this.mesh.visible = cells.length > 0;
  }
}
