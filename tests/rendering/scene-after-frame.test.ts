import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { OverlayDesaturation } from '../../src/rendering/desaturation';
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
    overlayDesaturation: new OverlayDesaturation(),
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

  /**
   * Never assume the rAF loop is running. An automation or background tab is
   * not painting, so `setAnimationLoop` is throttled to a full stop and every
   * frame callback — view sync, vehicle interpolation, FX lifetimes, camera
   * flight — stops with it. A capture that only calls `renderer.render()` then
   * photographs frozen time: cars pinned at their last interpolated position,
   * level-up labels accumulating forever because the wall-clock fade never
   * advances. Those artefacts read as game bugs and are not.
   *
   * So the capture path must pump a full presentation frame itself. Capturing
   * then IS the frame tick, which has its own consequence: animation advances
   * by real wall-clock between shots, so two captures taken microseconds apart
   * look identical no matter how much sim time passed between them.
   */
  it('pumps a presentation frame before reading the buffer, because rAF is stopped', () => {
    const { cityScene, render } = makeScene();
    const onFrame = vi.fn();
    cityScene.onFrame(onFrame);
    const toDataURL = vi.fn(() => 'jpeg');
    Object.assign(cityScene, {
      renderer: {
        render,
        domElement: {
          width: 800,
          height: 600,
          getBoundingClientRect: () => ({ width: 800, height: 600 }),
          toDataURL,
        },
      },
    });

    expect(cityScene.screenshot(0.7)).toBe('jpeg');

    // A bare render would satisfy toDataURL while leaving every time-based
    // visual frozen at whatever the last painted frame held.
    expect(onFrame, 'screenshot() must run the frame callbacks, not just render')
      .toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    expect(onFrame.mock.invocationCallOrder[0]!).toBeLessThan(
      render.mock.invocationCallOrder[0]!,
    );
    expect(render.mock.invocationCallOrder[0]!).toBeLessThan(
      toDataURL.mock.invocationCallOrder[0]!,
    );
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
