import { Raycaster, Vector2, Vector3 } from 'three';
import type { Camera, Ray } from 'three';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

const DIRECTION_EPSILON = 1e-10;
const INTERSECTION_EPSILON = 1e-7;

function clipAxis(
  origin: number,
  direction: number,
  min: number,
  max: number,
): readonly [number, number] | null {
  if (Math.abs(direction) < DIRECTION_EPSILON) {
    return origin < min || origin > max ? null : [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  }
  const a = (min - origin) / direction;
  const b = (max - origin) / direction;
  return a <= b ? [a, b] : [b, a];
}

/** Integer sim cell coordinates under the pointer. */
export interface PickedCell {
  x: number;
  y: number;
}

/**
 * Intersects the pointer ray with the shared piecewise-linear terrain surface
 * and floors the hit to integer sim cell coordinates.
 */
export class GroundPicker {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly hit = new Vector3();
  private readonly candidate = new Vector3();
  private readonly p00 = new Vector3();
  private readonly p10 = new Vector3();
  private readonly p01 = new Vector3();
  private readonly p11 = new Vector3();
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor(
    private readonly camera: Camera,
    private readonly element: HTMLElement,
    private readonly gridWidth: number,
    private readonly gridHeight: number,
  ) {}

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
  }

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
    const cell = this.intersect(clientX, clientY) ?? this.intersectClampedDatum(clientX, clientY);
    if (!cell) return null;
    return {
      x: Math.min(Math.max(cell.x, 0), this.gridWidth - 1),
      y: Math.min(Math.max(cell.y, 0), this.gridHeight - 1),
    };
  }

  private intersect(clientX: number, clientY: number): PickedCell | null {
    const ray = this.pointerRay(clientX, clientY);
    if (!ray) return null;
    const interval = this.mapInterval(ray);
    if (!interval) return null;
    const [entry, exit] = interval;
    const insideDistance = entry + Math.min(INTERSECTION_EPSILON, Math.max(0, exit - entry) / 2);
    this.hit.copy(ray.direction).multiplyScalar(insideDistance).add(ray.origin);
    let cellX = Math.min(Math.max(Math.floor(this.hit.x), 0), this.gridWidth - 1);
    let cellZ = Math.min(Math.max(Math.floor(this.hit.z), 0), this.gridHeight - 1);
    const stepX = Math.sign(ray.direction.x);
    const stepZ = Math.sign(ray.direction.z);
    const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ray.direction.x);
    const deltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ray.direction.z);
    let nextX = stepX === 0
      ? Number.POSITIVE_INFINITY
      : ((stepX > 0 ? cellX + 1 : cellX) - ray.origin.x) / ray.direction.x;
    let nextZ = stepZ === 0
      ? Number.POSITIVE_INFINITY
      : ((stepZ > 0 ? cellZ + 1 : cellZ) - ray.origin.z) / ray.direction.z;
    let cellEntry = entry;
    const maxVisits = this.gridWidth + this.gridHeight + 2;
    for (let visit = 0; visit < maxVisits; visit++) {
      if (cellX < 0 || cellZ < 0 || cellX >= this.gridWidth || cellZ >= this.gridHeight) break;
      const cellExit = Math.min(nextX, nextZ, exit);
      if (this.intersectCell(ray, cellX, cellZ, cellEntry, cellExit)) {
        return { x: cellX, y: cellZ };
      }
      if (cellExit >= exit - INTERSECTION_EPSILON) break;
      if (nextX < nextZ) {
        cellEntry = nextX;
        cellX += stepX;
        nextX += deltaX;
      } else if (nextZ < nextX) {
        cellEntry = nextZ;
        cellZ += stepZ;
        nextZ += deltaZ;
      } else {
        cellEntry = nextX;
        cellX += stepX;
        cellZ += stepZ;
        nextX += deltaX;
        nextZ += deltaZ;
      }
    }
    return null;
  }

  private pointerRay(clientX: number, clientY: number): Ray | null {
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
    return this.raycaster.ray;
  }

  /** Constant-work continuation datum for an active drag outside the finite map. */
  private intersectClampedDatum(clientX: number, clientY: number): PickedCell | null {
    const ray = this.pointerRay(clientX, clientY);
    if (!ray || Math.abs(ray.direction.y) < DIRECTION_EPSILON) return null;
    let datum = 0;
    for (let i = 0; i < 4; i++) {
      const distance = (datum - ray.origin.y) / ray.direction.y;
      if (distance < 0) return null;
      this.hit.copy(ray.direction).multiplyScalar(distance).add(ray.origin);
      const x = Math.min(Math.max(this.hit.x, 0), this.gridWidth);
      const z = Math.min(Math.max(this.hit.z, 0), this.gridHeight);
      datum = this.surface.groundHeightAt(x, z);
    }
    const distance = (datum - ray.origin.y) / ray.direction.y;
    this.hit.copy(ray.direction).multiplyScalar(distance).add(ray.origin);
    return { x: Math.floor(this.hit.x), y: Math.floor(this.hit.z) };
  }

  /** Positive ray interval clipped to the finite map and visible height slab. */
  private mapInterval(ray: Ray): readonly [number, number] | null {
    let entry = 0;
    let exit = Number.POSITIVE_INFINITY;
    const axes = [
      clipAxis(ray.origin.x, ray.direction.x, 0, this.gridWidth),
      clipAxis(ray.origin.y, ray.direction.y, this.surface.minHeight, this.surface.maxHeight),
      clipAxis(ray.origin.z, ray.direction.z, 0, this.gridHeight),
    ];
    for (const interval of axes) {
      if (!interval) return null;
      entry = Math.max(entry, interval[0]);
      exit = Math.min(exit, interval[1]);
    }
    return exit + INTERSECTION_EPSILON >= entry ? [entry, exit] : null;
  }

  /** Exact intersection against the two triangles used by one visible terrain cell. */
  private intersectCell(
    ray: Ray,
    x: number,
    z: number,
    entry: number,
    exit: number,
  ): boolean {
    const buildCenter = this.surface.heightAt(x + 0.5, z + 0.5);
    const groundCenter = this.surface.groundHeightAt(x + 0.5, z + 0.5);
    const water = Math.abs(buildCenter - groundCenter) > INTERSECTION_EPSILON;
    const height = (px: number, pz: number): number =>
      water ? groundCenter : this.surface.heightAt(px, pz);
    this.p00.set(x, height(x, z), z);
    this.p10.set(x + 1, height(x + 1, z), z);
    this.p01.set(x, height(x, z + 1), z + 1);
    this.p11.set(x + 1, height(x + 1, z + 1), z + 1);
    let nearest = Number.POSITIVE_INFINITY;
    nearest = this.considerTriangle(ray, this.p00, this.p01, this.p10, entry, exit, nearest);
    nearest = this.considerTriangle(ray, this.p10, this.p01, this.p11, entry, exit, nearest);
    return Number.isFinite(nearest);
  }

  private considerTriangle(
    ray: Ray,
    a: Vector3,
    b: Vector3,
    c: Vector3,
    entry: number,
    exit: number,
    nearest: number,
  ): number {
    const point = ray.intersectTriangle(a, b, c, false, this.candidate);
    if (!point) return nearest;
    const distance = point.distanceTo(ray.origin);
    if (
      distance + INTERSECTION_EPSILON < entry ||
      distance - INTERSECTION_EPSILON > exit ||
      distance >= nearest
    ) {
      return nearest;
    }
    this.hit.copy(point);
    return distance;
  }
}
