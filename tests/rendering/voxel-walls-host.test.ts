import { PerspectiveCamera, Scene, type Object3D, type Vector2 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { RendererLike } from 'voxel/three';

import type { BuildingRenderView } from '../../src/rendering/buildings-mesh';
import {
  VoxelWallsHost,
  voxelWallsRequested,
} from '../../src/rendering/voxel-walls-host';

function fakeRenderer(): RendererLike & { readonly dispose: ReturnType<typeof vi.fn> } {
  let pixelRatio = 1;
  return {
    domElement: {
      width: 640,
      height: 480,
      toDataURL: vi.fn(() => 'data:image/png;base64,x'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn((value: number) => { pixelRatio = value; }),
    getPixelRatio: vi.fn(() => pixelRatio),
    getSize: vi.fn((target: Vector2) => target.set(640, 480)),
    dispose: vi.fn(),
    info: {
      render: { calls: 0, triangles: 0, points: 0, lines: 0 },
      memory: { geometries: 0, textures: 0 },
    },
  } as unknown as RendererLike & { readonly dispose: ReturnType<typeof vi.fn> };
}

function makeHost() {
  const renderer = fakeRenderer();
  const scene = new Scene();
  const marker = new Scene();
  marker.name = 'city-owned-layer';
  scene.add(marker);
  const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 100);
  const host = new VoxelWallsHost({ renderer, scene, camera, width: 640, height: 480 });
  return { host, renderer, scene, camera, marker };
}

function view(id: number): BuildingRenderView {
  return { id, x: 2, y: 3, w: 2, h: 2, zone: 'R', level: 1, abandoned: false };
}

function voxelRoots(scene: Scene): Object3D[] {
  return scene.children.filter((child) => child.name === 'voxel-runtime');
}

describe('voxelWallsRequested', () => {
  it('opts in only on an explicit flag', () => {
    expect(voxelWallsRequested('?voxelWalls=1')).toBe(true);
    expect(voxelWallsRequested('?voxelWalls=0')).toBe(false);
    expect(voxelWallsRequested('?other=1')).toBe(false);
    expect(voxelWallsRequested('')).toBe(false);
  });
});

describe('VoxelWallsHost ownership', () => {
  it('mounts exactly one runtime root into City\'s scene', () => {
    const { scene, host } = makeHost();
    expect(voxelRoots(scene)).toHaveLength(1);
    host.dispose();
  });

  it('presents a frame across City\'s prepare/draw/acknowledge pair', () => {
    const { host, scene } = makeHost();
    host.upsert(view(1));
    host.prepareFrame(16);
    // City draws here; the acknowledgement is what lets Voxel present.
    host.commitFrame();

    expect(host.isInert).toBe(false);
    expect(voxelRoots(scene)).toHaveLength(1);
    host.dispose();
  });

  it('releases only its own objects on dispose', () => {
    const { host, renderer, scene, camera, marker } = makeHost();
    const cameraMatrix = camera.projectionMatrix.clone();
    host.upsert(view(1));
    host.prepareFrame(16);
    host.commitFrame();

    host.dispose();

    // Voxel's root is gone; City's own layer and borrowed objects survive.
    expect(voxelRoots(scene)).toHaveLength(0);
    expect(scene.children).toContain(marker);
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(renderer.setSize).not.toHaveBeenCalled();
    expect(renderer.setPixelRatio).not.toHaveBeenCalled();
    expect(camera.projectionMatrix.elements).toEqual(cameraMatrix.elements);
  });

  it('disposes idempotently, including with a frame in flight', () => {
    const { host } = makeHost();
    host.upsert(view(1));
    // Prepared but never acknowledged: disposal must abort the ticket.
    host.prepareFrame(16);

    expect(() => host.dispose()).not.toThrow();
    expect(() => host.dispose()).not.toThrow();
  });

  it('ignores frame traffic after disposal instead of resurrecting anything', () => {
    const { host, scene } = makeHost();
    host.upsert(view(1));
    host.prepareFrame(16);
    host.dispose();

    // City's frame loop may still be running for a tick; a disposed host must
    // absorb it silently rather than throw or re-mount.
    expect(() => host.upsert(view(2))).not.toThrow();
    expect(() => host.prepareFrame(32)).not.toThrow();
    expect(() => host.commitFrame()).not.toThrow();
    expect(voxelRoots(scene)).toHaveLength(0);
  });
});
