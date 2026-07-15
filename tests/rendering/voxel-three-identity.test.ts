import { Group, Object3D, PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { ThreeRenderRuntime } from 'voxel/three';

import { makeFakeRenderer } from './voxel-test-doubles';

/**
 * The linked `voxel` package carries its own Three devDependency, so a bundler
 * following the symlink can resolve a second copy. Two copies fail silently and
 * catastrophically: `scene.add` rejects foreign objects, `instanceof` checks
 * miss, and materials never match. `resolve.dedupe` in vite.config.ts prevents
 * it; these tests prove it rather than trusting the config.
 */
describe('linked voxel resolves exactly one Three runtime', () => {
  it('mounts its root into a scene constructed by this app', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 16 / 10, 0.1, 100);
    const runtime = new ThreeRenderRuntime({
      host: {
        kind: 'embedded',
        renderer: makeFakeRenderer(),
        scene,
        camera,
        drawOwnership: 'host',
        viewportOwnership: 'host',
        captureOwnership: 'host',
      },
      width: 320,
      height: 200,
    });

    // Voxel constructed these with its own import of 'three'. If that import
    // resolved to a different copy, they would not satisfy this app's classes
    // and Scene.add would have rejected them.
    expect(scene.children.length).toBeGreaterThan(0);
    for (const child of scene.children) {
      expect(child).toBeInstanceOf(Object3D);
    }
    expect(scene.children.some((child) => child instanceof Group)).toBe(true);

    runtime.dispose();
  });

  it('leaves the borrowed scene empty after disposal', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 16 / 10, 0.1, 100);
    const runtime = new ThreeRenderRuntime({
      host: {
        kind: 'embedded',
        renderer: makeFakeRenderer(),
        scene,
        camera,
        drawOwnership: 'host',
        viewportOwnership: 'host',
        captureOwnership: 'host',
      },
      width: 320,
      height: 200,
    });
    runtime.dispose();

    // Voxel owns only what it added; City's scene is its own again.
    expect(scene.children).toEqual([]);
  });
});
