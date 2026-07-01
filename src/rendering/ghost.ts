import { BoxGeometry, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
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
 * Translucent drag-preview boxes over the cells a road/bulldoze action would
 * affect. White while the path looks valid client-side, red when trivially
 * invalid — authoritative validation stays in the sim.
 */
export class GhostView {
  readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;

  constructor() {
    this.material = new MeshBasicMaterial({
      color: GHOST_VALID_COLOR,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(new BoxGeometry(1, GHOST_HEIGHT, 1), this.material, GHOST_CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'ghost';
    this.mesh.count = 0;
  }

  update(cells: readonly GhostCell[], valid: boolean): void {
    const matrix = new Matrix4();
    const count = Math.min(cells.length, GHOST_CAPACITY);
    for (let i = 0; i < count; i++) {
      matrix.makeTranslation(cells[i].x + 0.5, GHOST_SURFACE_Y + GHOST_HEIGHT / 2, cells[i].y + 0.5);
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.material.color.setHex(valid ? GHOST_VALID_COLOR : GHOST_INVALID_COLOR);
  }

  clear(): void {
    this.mesh.count = 0;
  }
}
