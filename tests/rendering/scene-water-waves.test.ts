import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Group, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import { CityScene } from '../../src/rendering/scene';
import { FLAT_TERRAIN_SURFACE } from '../../src/rendering/terrain-surface';
import { WaterWaveMaterial } from '../../src/rendering/water-wave-material';

interface PresentableCityScene {
  presentFrame(now: number): void;
}

describe('CityScene water wave clock', () => {
  it('discovers water materials and advances them from the shared presentation timestamp', () => {
    const render = vi.fn();
    const controls = {
      target: new Vector3(),
      update: vi.fn(),
    };
    const cityScene = Object.assign(Object.create(CityScene.prototype), {
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      controls,
      renderer: { render },
      terrainSurface: FLAT_TERRAIN_SURFACE,
      waterWaveMaterials: new Set<WaterWaveMaterial>(),
      frameCallbacks: [] as Array<(now: number) => void>,
      flight: null,
    }) as CityScene;
    const material = new WaterWaveMaterial();
    const terrain = new Group();
    terrain.add(new Mesh(new BufferGeometry(), material));
    const frameCallback = vi.fn();

    cityScene.add(terrain);
    cityScene.onFrame(frameCallback);
    (cityScene as unknown as PresentableCityScene).presentFrame(3_500);

    expect(material.waveTimeSeconds).toBe(3.5);
    expect(frameCallback).toHaveBeenCalledExactlyOnceWith(3_500);
    expect(controls.update).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });
});
