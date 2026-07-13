import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { GroundPicker } from '../../src/rendering/picking';
import {
  TerrainSurface,
  type TerrainSurfaceView,
} from '../../src/rendering/terrain-surface';

function piecewiseSurface(
  width: number,
  height: number,
  corners: Float32Array,
): TerrainSurfaceView {
  const cornerHeight = (x: number, z: number): number =>
    corners[Math.min(Math.max(z, 0), height) * (width + 1) + Math.min(Math.max(x, 0), width)];
  const heightAt = (x: number, z: number): number => {
    const cx = Math.min(Math.max(x, 0), width);
    const cz = Math.min(Math.max(z, 0), height);
    const cellX = Math.min(Math.floor(cx), width - 1);
    const cellZ = Math.min(Math.floor(cz), height - 1);
    const u = cx - cellX;
    const v = cz - cellZ;
    const h00 = cornerHeight(cellX, cellZ);
    const h10 = cornerHeight(cellX + 1, cellZ);
    const h01 = cornerHeight(cellX, cellZ + 1);
    const h11 = cornerHeight(cellX + 1, cellZ + 1);
    return u + v <= 1
      ? h00 + (h10 - h00) * u + (h01 - h00) * v
      : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  };
  return {
    width,
    height,
    minHeight: Math.min(...corners),
    maxHeight: Math.max(...corners),
    cellHeight: (x, z) => heightAt(x + 0.5, z + 0.5),
    cornerHeight,
    heightAt,
    groundHeightAt: heightAt,
    footprintRange: (x, z, w, h) => {
      const values: number[] = [];
      for (let dz = 0; dz <= h; dz++) {
        for (let dx = 0; dx <= w; dx++) values.push(cornerHeight(x + dx, z + dz));
      }
      return { min: Math.min(...values), max: Math.max(...values) };
    },
  };
}

describe('GroundPicker', () => {
  it('round-trips a projected point on elevated terrain', () => {
    const width = 8;
    const height = 8;
    const surface = new TerrainSurface({
      width,
      height,
      elevation: new Float32Array(width * height).fill(0.85),
      seaLevel: 0.35,
      water: new Uint8Array(width * height),
    });
    const camera = new PerspectiveCamera(55, 800 / 600, 0.1, 100);
    const target = new Vector3(4.5, surface.heightAt(4.5, 4.5), 4.5);
    camera.position.set(1, 7, 12);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const projected = target.clone().project(camera);
    const element = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLElement;
    const picker = new GroundPicker(camera, element, width, height);
    picker.setTerrainSurface(surface);

    expect(picker.pick((projected.x * 0.5 + 0.5) * 800, (-projected.y * 0.5 + 0.5) * 600)).toEqual({
      x: 4,
      y: 4,
    });
    expect(picker.pick(-400, 300)).toBeNull();
    expect(picker.pickClamped(-400, 300)).toMatchObject({ x: 0 });
  });

  it('returns the first visible ridge along a shallow ray', () => {
    const width = 8;
    const height = 12;
    const corners = new Float32Array((width + 1) * (height + 1));
    for (const z of [3, 8]) {
      for (let x = 0; x <= width; x++) corners[z * (width + 1) + x] = 1;
    }
    const ridgeSurface = piecewiseSurface(width, height, corners);
    const camera = new PerspectiveCamera(55, 800 / 600, 0.1, 100);
    camera.position.set(4, 1.4, -2);
    camera.lookAt(4, 0, 12);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const element = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLElement;
    const picker = new GroundPicker(camera, element, width, height);
    picker.setTerrainSurface(ridgeSurface);

    const picked = picker.pick(400, 300);
    expect(picked).not.toBeNull();
    expect(picked?.y).toBeLessThanOrEqual(3);
  });

  it('hits a grazing terrain triangle before the distant flat ground', () => {
    const width = 64;
    const height = 2;
    const corners = new Float32Array((width + 1) * (height + 1));
    corners[1 * (width + 1) + 2] = 1;
    const baseSurface = piecewiseSurface(width, height, corners);
    let heightSamples = 0;
    const surface: TerrainSurfaceView = {
      ...baseSurface,
      heightAt: (x, z) => {
        heightSamples++;
        return baseSurface.heightAt(x, z);
      },
    };
    const camera = new PerspectiveCamera(55, 800 / 600, 0.1, 200);
    camera.position.set(-1, 1.02, 0.98);
    camera.lookAt(1.98, 0.96, 0.98);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const element = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLElement;
    const picker = new GroundPicker(camera, element, width, height);
    picker.setTerrainSurface(surface);

    expect(picker.pick(400, 300)).toEqual({ x: 1, y: 0 });
    expect(heightSamples).toBeLessThan(100);
  });
});
