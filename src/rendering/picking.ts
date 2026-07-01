import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Camera } from 'three';

/** Integer sim cell coordinates under the pointer. */
export interface PickedCell {
  x: number;
  y: number;
}

/**
 * Raycasts the pointer against the mathematical y=0 ground plane (not any
 * mesh) and floors the hit to integer sim cell coordinates.
 */
export class GroundPicker {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly hit = new Vector3();

  constructor(
    private readonly camera: Camera,
    private readonly element: HTMLElement,
    private readonly gridWidth: number,
    private readonly gridHeight: number,
  ) {}

  /** Cell under the pointer, or null when the ray misses the plane or lands outside the grid. */
  pick(clientX: number, clientY: number): PickedCell | null {
    const cell = this.intersect(clientX, clientY);
    if (!cell) return null;
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.gridWidth || cell.y >= this.gridHeight) {
      return null;
    }
    return cell;
  }

  /** Like pick(), but clamps into grid bounds — keeps an active drag usable while the pointer roams off-map. */
  pickClamped(clientX: number, clientY: number): PickedCell | null {
    const cell = this.intersect(clientX, clientY);
    if (!cell) return null;
    return {
      x: Math.min(Math.max(cell.x, 0), this.gridWidth - 1),
      y: Math.min(Math.max(cell.y, 0), this.gridHeight - 1),
    };
  }

  private intersect(clientX: number, clientY: number): PickedCell | null {
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    // Don't depend on the render loop having run: background tabs throttle
    // rAF to zero, leaving matrixWorld stale (breaks automated playtests).
    this.camera.updateMatrixWorld();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    return { x: Math.floor(this.hit.x), y: Math.floor(this.hit.z) };
  }
}
