import { BufferAttribute, BufferGeometry, Color } from 'three';
import { buildSurfacePatch } from './surface-geometry';
import type { TerrainSurfaceView } from './terrain-surface';

const colorCache = new Map<number, Color>();

/** Shared immutable Color instances for hex constants (do not mutate). */
export function colorOf(hex: number): Color {
  let color = colorCache.get(hex);
  if (!color) {
    color = new Color(hex);
    colorCache.set(hex, color);
  }
  return color;
}

type Point = readonly [number, number, number];

const sub = (a: Point, b: Point): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const cross = (a: Point, b: Point): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const normalize = (v: Point): [number, number, number] => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

/**
 * Accumulates merged quads, boxes, and low-poly solids into one BufferGeometry.
 * Faces never share vertices, so the geometry stays flat-shaded — the game's
 * model-table look. Shared by roads, streetscape, and utility structures.
 */
export class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  /** Number of vertices emitted so far — pair with boundsSince for part AABBs. */
  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Axis-aligned bounds of every vertex emitted at or after `startVertex`. */
  boundsSince(startVertex: number): {
    min: [number, number, number];
    max: [number, number, number];
  } {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = startVertex * 3; i < this.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], this.positions[i + axis]);
        max[axis] = Math.max(max[axis], this.positions[i + axis]);
      }
    }
    return { min, max };
  }

  private corners(
    points: ReadonlyArray<Point>,
    normal: Point = [0, 1, 0],
  ): void {
    const base = this.positions.length / 3;
    for (const point of points) this.positions.push(point[0], point[1], point[2]);
    for (let i = 0; i < 4; i++) this.normals.push(normal[0], normal[1], normal[2]);
    this.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  /** One rectangular face: origin o plus edge vectors u and v, flat normal n. */
  private face(
    o: Point,
    u: Point,
    v: Point,
    n: Point,
  ): void {
    this.corners([
      o,
      [o[0] + u[0], o[1] + u[1], o[2] + u[2]],
      [o[0] + v[0], o[1] + v[1], o[2] + v[2]],
      [o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2]],
    ], n);
  }

  private tri(a: Point, b: Point, c: Point, normal: Point): void {
    const base = this.positions.length / 3;
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.normals.push(normal[0], normal[1], normal[2]);
    this.indices.push(base, base + 1, base + 2);
  }

  private pushColor(vertexStart: number, color: Color): void {
    const added = this.positions.length / 3 - vertexStart;
    for (let i = 0; i < added; i++) this.colors.push(color.r, color.g, color.b);
  }

  /** Upward-facing quad covering [x0,x1]×[z0,z1] at height y. */
  quad(x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.face([x0, y, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0], [0, 1, 0]);
  }

  surfaceQuad(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    lift: number,
    surface: TerrainSurfaceView,
  ): void {
    this.corners([
      [x0, surface.heightAt(x0, z0) + lift, z0],
      [x1, surface.heightAt(x1, z0) + lift, z0],
      [x0, surface.heightAt(x0, z1) + lift, z1],
      [x1, surface.heightAt(x1, z1) + lift, z1],
    ]);
  }

  surfacePatch(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    lift: number,
    surface: TerrainSurfaceView,
  ): number {
    const patch = buildSurfacePatch(surface, x0, z0, x1, z1, lift);
    const base = this.positions.length / 3;
    this.positions.push(...patch.positions);
    const count = patch.positions.length / 3;
    for (let i = 0; i < count; i++) this.normals.push(0, 1, 0);
    for (const index of patch.indices) this.indices.push(base + index);
    return count;
  }

  /** Upward-facing quad with a per-vertex color for one merged detail layer. */
  coloredQuad(x0: number, z0: number, x1: number, z1: number, y: number, color: Color): void {
    this.quad(x0, z0, x1, z1, y);
    for (let i = 0; i < 4; i++) this.colors.push(color.r, color.g, color.b);
  }

  coloredSurfacePatch(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    lift: number,
    surface: TerrainSurfaceView,
    color: Color,
  ): void {
    const count = this.surfacePatch(x0, z0, x1, z1, lift, surface);
    for (let i = 0; i < count; i++) this.colors.push(color.r, color.g, color.b);
  }

  /** Colored quad from four explicit corners [p00, p10, p01, p11]. */
  coloredQuadCorners(points: ReadonlyArray<Point>, color: Color): void {
    const start = this.positions.length / 3;
    const normal = normalize(cross(sub(points[2], points[0]), sub(points[1], points[0])));
    this.corners(points, normal);
    this.pushColor(start, color);
  }

  /** Axis-aligned box between opposite corners (all six faces). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    this.face([x0, y1, z0], [dx, 0, 0], [0, 0, dz], [0, 1, 0]); // top
    this.face([x0, y0, z0], [0, 0, dz], [dx, 0, 0], [0, -1, 0]); // bottom
    this.face([x1, y0, z0], [0, 0, dz], [0, dy, 0], [1, 0, 0]); // +x
    this.face([x0, y0, z0], [0, dy, 0], [0, 0, dz], [-1, 0, 0]); // -x
    this.face([x0, y0, z1], [0, dy, 0], [dx, 0, 0], [0, 0, 1]); // +z
    this.face([x0, y0, z0], [dx, 0, 0], [0, dy, 0], [0, 0, -1]); // -z
  }

  coloredBox(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    color: Color,
  ): void {
    const start = this.positions.length / 3;
    this.box(x0, y0, z0, x1, y1, z1);
    this.pushColor(start, color);
  }

  /**
   * Low-poly frustum (cylinder/cone) between two points with end radii r0/r1.
   * Ends are capped whenever their radius is meaningful.
   */
  coloredTube(
    from: Point,
    to: Point,
    r0: number,
    r1: number,
    segments: number,
    color: Color | number,
  ): void {
    const tint = typeof color === 'number' ? colorOf(color) : color;
    const start = this.positions.length / 3;
    const axis = normalize(sub(to, from));
    const ref: Point = Math.abs(axis[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
    const side = normalize(cross(ref, axis));
    const up = cross(axis, side);
    const ring = (base: Point, radius: number, theta: number): [number, number, number] => [
      base[0] + (side[0] * Math.cos(theta) + up[0] * Math.sin(theta)) * radius,
      base[1] + (side[1] * Math.cos(theta) + up[1] * Math.sin(theta)) * radius,
      base[2] + (side[2] * Math.cos(theta) + up[2] * Math.sin(theta)) * radius,
    ];
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      const b = ((k + 1) / segments) * Math.PI * 2;
      const p00 = ring(from, r0, a);
      const p10 = ring(from, r0, b);
      const p01 = ring(to, r1, a);
      const p11 = ring(to, r1, b);
      const normal = normalize(cross(sub(p01, p00), sub(p10, p00)));
      this.corners([p00, p10, p01, p11], normal);
      // End caps as fans, wound to face outward along the axis.
      if (r0 > 1e-3) this.tri(from, ring(from, r0, b), ring(from, r0, a), [-axis[0], -axis[1], -axis[2]]);
      if (r1 > 1e-3) this.tri(to, ring(to, r1, a), ring(to, r1, b), axis);
    }
    this.pushColor(start, tint);
  }

  /**
   * Oriented (optionally tapered) box from `from` to `to`: width lies along
   * cross(upHint, axis) and thickness along the resulting up vector.
   */
  coloredBeam(
    from: Point,
    to: Point,
    upHint: Point,
    widthFrom: number,
    thickFrom: number,
    widthTo: number,
    thickTo: number,
    color: Color | number,
  ): void {
    const tint = typeof color === 'number' ? colorOf(color) : color;
    const axis = normalize(sub(to, from));
    const side = normalize(cross(upHint, axis));
    const up = cross(axis, side);
    const corner = (base: Point, w: number, t: number, sSign: number, uSign: number): Point => [
      base[0] + side[0] * w * 0.5 * sSign + up[0] * t * 0.5 * uSign,
      base[1] + side[1] * w * 0.5 * sSign + up[1] * t * 0.5 * uSign,
      base[2] + side[2] * w * 0.5 * sSign + up[2] * t * 0.5 * uSign,
    ];
    const app = corner(from, widthFrom, thickFrom, 1, 1);
    const apm = corner(from, widthFrom, thickFrom, 1, -1);
    const amp = corner(from, widthFrom, thickFrom, -1, 1);
    const amm = corner(from, widthFrom, thickFrom, -1, -1);
    const bpp = corner(to, widthTo, thickTo, 1, 1);
    const bpm = corner(to, widthTo, thickTo, 1, -1);
    const bmp = corner(to, widthTo, thickTo, -1, 1);
    const bmm = corner(to, widthTo, thickTo, -1, -1);
    this.coloredQuadCorners([amp, app, bmp, bpp], tint); // +up
    this.coloredQuadCorners([apm, amm, bpm, bmm], tint); // -up
    this.coloredQuadCorners([app, apm, bpp, bpm], tint); // +side
    this.coloredQuadCorners([amm, amp, bmm, bmp], tint); // -side
    this.coloredQuadCorners([amm, apm, amp, app], tint); // from cap
    this.coloredQuadCorners([bmm, bmp, bpm, bpp], tint); // to cap
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    if (this.colors.length > 0) {
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    }
    geometry.setIndex(new BufferAttribute(new Uint32Array(this.indices), 1));
    geometry.computeVertexNormals();
    return geometry;
  }
}
