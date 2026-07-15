import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { CityScene } from '../../src/rendering/scene';
import { FLAT_TERRAIN_SURFACE } from '../../src/rendering/terrain-surface';
import type { WaterWaveMaterial } from '../../src/rendering/water-wave-material';

interface PresentableCityScene {
  presentFrame(now: number): void;
}

function makeScene() {
  const render = vi.fn();
  const controls = { target: new Vector3(), update: vi.fn() };
  const cityScene = Object.assign(Object.create(CityScene.prototype), {
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    controls,
    renderer: { render },
    terrainSurface: FLAT_TERRAIN_SURFACE,
    waterWaveMaterials: new Set<WaterWaveMaterial>(),
    frameCallbacks: [] as Array<(now: number) => void>,
    afterFrameCallbacks: [] as Array<(now: number) => void>,
    flight: null,
  }) as CityScene;
  Object.assign(cityScene, {
    updateFlight: vi.fn(),
    conformCameraTargetToTerrain: vi.fn(),
  });
  return { cityScene, render };
}

/**
 * An embedded renderer cannot draw for itself, so it needs the draw
 * acknowledged after it happens. onFrame runs before the draw and cannot
 * serve that; onAfterFrame is the other half of the pair.
 */
describe('CityScene after-frame callbacks', () => {
  it('runs after the draw, and frame callbacks before it', () => {
    const { cityScene, render } = makeScene();
    const before = vi.fn();
    const after = vi.fn();

    cityScene.onFrame(before);
    cityScene.onAfterFrame(after);
    (cityScene as unknown as PresentableCityScene).presentFrame(1_000);

    expect(before).toHaveBeenCalledExactlyOnceWith(1_000);
    expect(after).toHaveBeenCalledExactlyOnceWith(1_000);
    expect(render).toHaveBeenCalledOnce();
    // The ordering is the whole contract: prepare, draw, acknowledge.
    expect(before.mock.invocationCallOrder[0]!).toBeLessThan(
      render.mock.invocationCallOrder[0]!,
    );
    expect(render.mock.invocationCallOrder[0]!).toBeLessThan(
      after.mock.invocationCallOrder[0]!,
    );
  });

  it('runs every after-frame callback once per presentation', () => {
    const { cityScene } = makeScene();
    const first = vi.fn();
    const second = vi.fn();
    cityScene.onAfterFrame(first);
    cityScene.onAfterFrame(second);

    (cityScene as unknown as PresentableCityScene).presentFrame(16);
    (cityScene as unknown as PresentableCityScene).presentFrame(32);

    expect(first.mock.calls).toEqual([[16], [32]]);
    expect(second.mock.calls).toEqual([[16], [32]]);
  });

  it('still acknowledges the draw when an after-frame callback throws', () => {
    const { cityScene, render } = makeScene();
    const failing = vi.fn(() => { throw new Error('adapter commit failed'); });
    const healthy = vi.fn();
    cityScene.onAfterFrame(failing);
    cityScene.onAfterFrame(healthy);

    // One misbehaving consumer must not silently strand the others, and the
    // frame itself was already drawn, so the loop must keep running.
    expect(() => (cityScene as unknown as PresentableCityScene).presentFrame(48))
      .not.toThrow();
    expect(render).toHaveBeenCalledOnce();
    expect(healthy).toHaveBeenCalledExactlyOnceWith(48);
  });
});
