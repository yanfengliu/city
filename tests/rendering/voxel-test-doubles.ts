import type { Vector2 } from 'three';
import { vi } from 'vitest';

/**
 * A renderer double standing in for City's WebGLRenderer at the voxel boundary.
 * Voxel borrows the renderer in embedded mode and must never resize, configure,
 * or draw through it, so the double only needs to satisfy the shape voxel reads.
 */
export function makeFakeRenderer() {
  let pixelRatio = 1;
  const domElement = {
    width: 320,
    height: 200,
    toDataURL: vi.fn(() => 'data:image/png;base64,fake'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return {
    domElement,
    render: vi.fn(),
    setSize: vi.fn((width: number, height: number) => {
      domElement.width = width;
      domElement.height = height;
    }),
    setPixelRatio: vi.fn((value: number) => { pixelRatio = value; }),
    getPixelRatio: vi.fn(() => pixelRatio),
    getSize: vi.fn((target: Vector2) => target.set(domElement.width, domElement.height)),
    dispose: vi.fn(),
    info: {
      render: { calls: 0, triangles: 0, points: 0, lines: 0 },
      memory: { geometries: 0, textures: 0 },
    },
  };
}
