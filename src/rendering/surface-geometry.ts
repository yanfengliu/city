import { PlaneGeometry } from 'three';
import type { BufferAttribute } from 'three';
import type { TerrainSurfaceView } from './terrain-surface';

interface SurfacePoint {
  x: number;
  z: number;
}

export interface SurfacePatch {
  positions: number[];
  indices: number[];
}

const CLIP_EPSILON = 1e-9;

function samePoint(a: SurfacePoint, b: SurfacePoint): boolean {
  return Math.abs(a.x - b.x) <= CLIP_EPSILON && Math.abs(a.z - b.z) <= CLIP_EPSILON;
}

/** Clips a clockwise x/z polygon to one side of x+z=diagonal. */
function clipToTerrainTriangle(
  polygon: readonly SurfacePoint[],
  diagonal: number,
  keepLower: boolean,
): SurfacePoint[] {
  const result: SurfacePoint[] = [];
  const signedDistance = (point: SurfacePoint): number =>
    (point.x + point.z - diagonal) * (keepLower ? 1 : -1);
  let previous = polygon[polygon.length - 1];
  let previousDistance = signedDistance(previous);
  let previousInside = previousDistance <= CLIP_EPSILON;
  for (const current of polygon) {
    const currentDistance = signedDistance(current);
    const currentInside = currentDistance <= CLIP_EPSILON;
    if (currentInside !== previousInside) {
      const t = previousDistance / (previousDistance - currentDistance);
      result.push({
        x: previous.x + (current.x - previous.x) * t,
        z: previous.z + (current.z - previous.z) * t,
      });
    }
    if (currentInside) result.push(current);
    previous = current;
    previousDistance = currentDistance;
    previousInside = currentInside;
  }
  const deduplicated = result.filter(
    (point, index) => index === 0 || !samePoint(point, result[index - 1]),
  );
  if (
    deduplicated.length > 1 &&
    samePoint(deduplicated[0], deduplicated[deduplicated.length - 1])
  ) {
    deduplicated.pop();
  }
  return deduplicated;
}

/**
 * Axis-aligned rectangle contained within one map cell, split along that
 * cell's terrain-triangle seam. Each output triangle therefore lies exactly
 * on one of the two planes sampled by TerrainSurface.heightAt().
 */
export function buildSurfacePatch(
  surface: TerrainSurfaceView,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  lift: number,
): SurfacePatch {
  const rectangle: SurfacePoint[] = [
    { x: x0, z: z0 },
    { x: x0, z: z1 },
    { x: x1, z: z1 },
    { x: x1, z: z0 },
  ];
  const cellX = Math.floor((x0 + x1) / 2);
  const cellZ = Math.floor((z0 + z1) / 2);
  const diagonal = cellX + cellZ + 1;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const polygon of [
    clipToTerrainTriangle(rectangle, diagonal, true),
    clipToTerrainTriangle(rectangle, diagonal, false),
  ]) {
    if (polygon.length < 3) continue;
    const base = positions.length / 3;
    for (const point of polygon) {
      positions.push(point.x, surface.heightAt(point.x, point.z) + lift, point.z);
    }
    for (let i = 1; i < polygon.length - 1; i++) {
      indices.push(base, base + i, base + i + 1);
    }
  }
  return { positions, indices };
}

/** Writes one terrain-conforming quad in the winding shared by ground meshes. */
export function writeSurfaceQuad(
  target: Float32Array,
  offset: number,
  surface: TerrainSurfaceView,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  lift: number,
): void {
  target.set(
    [
      x0, surface.heightAt(x0, z0) + lift, z0,
      x1, surface.heightAt(x1, z0) + lift, z0,
      x0, surface.heightAt(x0, z1) + lift, z1,
      x1, surface.heightAt(x1, z1) + lift, z1,
    ],
    offset,
  );
}

/** Full-map textured grid draped over the shared surface. */
export function buildDrapedPlaneGeometry(
  width: number,
  height: number,
  surface: TerrainSurfaceView,
  lift: number,
  northV: 0 | 1,
): PlaneGeometry {
  const geometry = new PlaneGeometry(width, height, width, height).rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + width / 2;
    const z = positions.getZ(i) + height / 2;
    positions.setY(i, surface.heightAt(x, z) + lift);
  }
  if (northV === 0) {
    const uv = geometry.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
