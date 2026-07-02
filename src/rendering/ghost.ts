import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import {
  GHOST_CAPACITY,
  GHOST_HEIGHT,
  GHOST_INVALID_COLOR,
  GHOST_OPACITY,
  GHOST_SURFACE_Y,
  GHOST_VALID_COLOR,
} from './constants';

/** Sim cell coordinates (plain data; rendering must not import sim types). */
export interface GhostCell {
  x: number;
  y: number;
}

/**
 * Translucent drag-preview boxes over the cells a road/bulldoze/zone action
 * would affect. Validity may be a single flag (all-or-nothing commands like
 * roads, which reject the whole drag) or per-cell (zone/dezone, which paint
 * only the eligible subset — each cell tints honestly). Colors: tint (white
 * by default, zone color for zone tools) when valid, red when invalid —
 * authoritative validation stays in the sim. Selections beyond capacity clip
 * visually; the submitted command is unaffected.
 */
export class GhostView {
  readonly mesh: InstancedMesh;

  constructor() {
    const material = new MeshBasicMaterial({
      color: 0xffffff, // per-instance colors carry the tint
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(new BoxGeometry(1, GHOST_HEIGHT, 1), material, GHOST_CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'ghost';
    this.mesh.count = 0;
  }

  update(
    cells: readonly GhostCell[],
    validity: boolean | readonly boolean[],
    tint: number = GHOST_VALID_COLOR,
  ): void {
    const matrix = new Matrix4();
    const count = Math.min(cells.length, GHOST_CAPACITY);
    for (let i = 0; i < count; i++) {
      matrix.makeTranslation(cells[i].x + 0.5, GHOST_SURFACE_Y + GHOST_HEIGHT / 2, cells[i].y + 0.5);
      this.mesh.setMatrixAt(i, matrix);
      const valid = typeof validity === 'boolean' ? validity : (validity[i] ?? false);
      this.color.setHex(valid ? tint : GHOST_INVALID_COLOR);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private readonly color = new Color();

  clear(): void {
    this.mesh.count = 0;
  }
}
