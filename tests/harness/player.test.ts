import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import type { CityScene } from '../../src/rendering/scene';
import {
  FLAT_TERRAIN_SURFACE,
  type TerrainSurfaceView,
} from '../../src/rendering/terrain-surface';
import { createPlayerInput } from '../../src/harness/player';

describe('createPlayerInput', () => {
  it('refreshes its picker when terrain arrives after harness construction', () => {
    const camera = new PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(1, 8, 1);
    camera.lookAt(1, 0, 1);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const element = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      dispatchEvent: () => true,
    } as unknown as HTMLElement;
    let current: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
    const scene = {
      camera,
      renderer: { domElement: element },
      getTerrainSurface: () => current,
      worldToScreen: () => ({ sx: 50, sy: 50, onScreen: true }),
      screenshot: () => '',
    } as unknown as CityScene;
    const player = createPlayerInput(scene);
    const groundHeightAt = vi.fn(() => 0.6);
    current = { ...FLAT_TERRAIN_SURFACE, maxHeight: 0.6, groundHeightAt };

    player.cellAt(50, 50);

    expect(groundHeightAt).toHaveBeenCalled();
  });
});
