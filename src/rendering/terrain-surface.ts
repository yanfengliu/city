import {
  TERRAIN_MAX_RELIEF,
  TERRAIN_RELIEF_CEILING,
  WATER_SURFACE_Y,
} from './constants';

/** Static terrain data delivered once in the worker `ready` payload. */
export interface TerrainSurfaceData {
  width: number;
  height: number;
  elevation: Float32Array;
  seaLevel: number;
  water: Uint8Array;
}

export interface HeightRange {
  min: number;
  max: number;
}

export interface TerrainSurfaceView {
  readonly width: number;
  readonly height: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  cellHeight(x: number, z: number): number;
  cornerHeight(x: number, z: number): number;
  heightAt(x: number, z: number): number;
  groundHeightAt(x: number, z: number): number;
  footprintRange(x: number, z: number, width: number, height: number): HeightRange;
}

/**
 * Renderer-owned view of the seeded terrain. It converts cell samples into a
 * shared (width+1)x(height+1) vertex field so every presentation layer uses
 * exactly the same piecewise-linear surface.
 */
export class TerrainSurface implements TerrainSurfaceView {
  readonly width: number;
  readonly height: number;
  readonly minHeight: number = WATER_SURFACE_Y;
  readonly maxHeight: number;
  private readonly water: Uint8Array;
  private readonly cellHeights: Float32Array;
  private readonly cornerHeights: Float32Array;
  private readonly flatCells: ReadonlySet<number>;

  constructor(data: TerrainSurfaceData, flatCells: ReadonlySet<number> = new Set()) {
    this.width = data.width;
    this.height = data.height;
    this.water = data.water;
    this.flatCells = flatCells;
    this.cellHeights = new Float32Array(data.width * data.height);
    let maxHeight = 0;
    for (let i = 0; i < this.cellHeights.length; i++) {
      const denominator = Math.max(TERRAIN_RELIEF_CEILING - data.seaLevel, Number.EPSILON);
      const t = Math.min(Math.max((data.elevation[i] - data.seaLevel) / denominator, 0), 1);
      const height = TERRAIN_MAX_RELIEF * t * t * (3 - 2 * t);
      this.cellHeights[i] = height;
      if (data.water[i] !== 1) maxHeight = Math.max(maxHeight, height);
    }
    this.cornerHeights = this.buildCornerHeights();
    this.maxHeight = maxHeight;
  }

  /** Coast-relative relief at the center of one cell. */
  cellHeight(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) return 0;
    return this.cellHeights[z * this.width + x];
  }

  /** Shared land vertex height. Coordinates are integer grid corners. */
  cornerHeight(x: number, z: number): number {
    const cx = Math.min(Math.max(Math.round(x), 0), this.width);
    const cz = Math.min(Math.max(Math.round(z), 0), this.height);
    return this.cornerHeights[cz * (this.width + 1) + cx];
  }

  /**
   * Build datum at a world point. Water is intentionally y=0 here so bridges,
   * invalid ghosts, and overlays retain their established water-relative lift.
   * Interpolation follows the same two-triangle diagonal as terrain-mesh.
   */
  heightAt(x: number, z: number): number {
    const clampedX = Math.min(Math.max(x, 0), this.width);
    const clampedZ = Math.min(Math.max(z, 0), this.height);
    const cellX = Math.min(Math.floor(clampedX), this.width - 1);
    const cellZ = Math.min(Math.floor(clampedZ), this.height - 1);
    const u = clampedX - cellX;
    const v = clampedZ - cellZ;
    const h00 = this.cornerHeight(cellX, cellZ);
    const h10 = this.cornerHeight(cellX + 1, cellZ);
    const h01 = this.cornerHeight(cellX, cellZ + 1);
    const h11 = this.cornerHeight(cellX + 1, cellZ + 1);
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  /** Visible terrain top for picking: recessed water, raised land. */
  groundHeightAt(x: number, z: number): number {
    const cellX = Math.min(Math.max(Math.floor(x), 0), this.width - 1);
    const cellZ = Math.min(Math.max(Math.floor(z), 0), this.height - 1);
    return this.water[cellZ * this.width + cellX] === 1
      ? WATER_SURFACE_Y
      : this.heightAt(x, z);
  }

  /** Minimum and maximum shared vertex height beneath a level footprint. */
  footprintRange(x: number, z: number, width: number, height: number): HeightRange {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let dz = 0; dz <= height; dz++) {
      for (let dx = 0; dx <= width; dx++) {
        const value = this.cornerHeight(x + dx, z + dz);
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
  }

  private buildCornerHeights(): Float32Array {
    const corners = new Float32Array((this.width + 1) * (this.height + 1));
    for (let z = 0; z <= this.height; z++) {
      for (let x = 0; x <= this.width; x++) {
        let sum = 0;
        let count = 0;
        let touchesWater = false;
        let touchesFlatCell = false;
        for (let dz = -1; dz <= 0; dz++) {
          for (let dx = -1; dx <= 0; dx++) {
            const cellX = x + dx;
            const cellZ = z + dz;
            if (cellX < 0 || cellZ < 0 || cellX >= this.width || cellZ >= this.height) continue;
            const index = cellZ * this.width + cellX;
            if (this.flatCells.has(index)) touchesFlatCell = true;
            if (this.water[index] === 1) touchesWater = true;
            else {
              sum += this.cellHeights[index];
              count++;
            }
          }
        }
        corners[z * (this.width + 1) + x] =
          touchesWater || touchesFlatCell || count === 0 ? 0 : sum / count;
      }
    }
    return corners;
  }
}

/** Initial boot surface used until the worker delivers terrain. */
export const FLAT_TERRAIN_SURFACE: TerrainSurfaceView = {
  width: 0,
  height: 0,
  minHeight: 0,
  maxHeight: 0,
  cellHeight: () => 0,
  cornerHeight: () => 0,
  heightAt: () => 0,
  groundHeightAt: () => 0,
  footprintRange: (): HeightRange => ({ min: 0, max: 0 }),
};
