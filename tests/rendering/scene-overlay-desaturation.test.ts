import { describe, expect, it, vi } from 'vitest';
import {
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Material,
} from 'three';
import { OverlayDesaturation } from '../../src/rendering/desaturation';
import { CityScene } from '../../src/rendering/scene';
import { ShadowMapUpdatePolicy } from '../../src/rendering/shadow-update';
import { FLAT_TERRAIN_SURFACE } from '../../src/rendering/terrain-surface';

interface PresentableCityScene {
  presentFrame(now: number): void;
}

const BUILTIN_FRAGMENT = `void main() {
	#include <colorspace_fragment>
	#include <dithering_fragment>
}`;

function compiledFragment(material: Material): string {
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: BUILTIN_FRAGMENT };
  material.onBeforeCompile(shader as never, null as never);
  return shader.fragmentShader;
}

function makeCityScene(): CityScene {
  const scene = new Scene();
  scene.fog = new Fog(0x000000, 70, 320);
  scene.background = new Color(0x000000);
  return Object.assign(Object.create(CityScene.prototype), {
    scene,
    camera: new PerspectiveCamera(),
    controls: { target: new Vector3(), update: vi.fn() },
    renderer: { render: vi.fn(), shadowMap: { needsUpdate: false } },
    terrainSurface: FLAT_TERRAIN_SURFACE,
    waterWaveMaterials: new Set(),
    frameCallbacks: [],
    afterFrameCallbacks: [],
    flight: null,
    gridWidth: 128,
    gridHeight: 128,
    hemi: new HemisphereLight(),
    sun: new DirectionalLight(),
    sky: {
      material: {
        uniforms: { topColor: { value: new Color() }, horizonColor: { value: new Color() } },
      },
    },
    scratch: new Color(),
    shadowUpdates: new ShadowMapUpdatePolicy(),
    overlayDesaturation: new OverlayDesaturation(),
    updateFlight: vi.fn(),
    conformCameraTargetToTerrain: vi.fn(),
  }) as CityScene;
}

describe('CityScene overlay desaturation', () => {
  it('patches materials as content is added and toggles them with the overlay', () => {
    const cityScene = makeCityScene();
    const material = new MeshLambertMaterial();
    cityScene.add(new Mesh(new BufferGeometry(), material));
    expect(compiledFragment(material)).toContain('uOverlayDesaturate)');

    expect(cityScene.getOverlayDesaturation()).toBe(false);
    cityScene.setOverlayDesaturation(true);
    expect(cityScene.getOverlayDesaturation()).toBe(true);
    cityScene.setOverlayDesaturation(false);
    expect(cityScene.getOverlayDesaturation()).toBe(false);
  });

  it('catches materials that bypassed add() — enabling sweeps the scene, frames sweep late arrivals', () => {
    const cityScene = makeCityScene();
    const preexisting = new MeshLambertMaterial();
    cityScene.scene.add(new Mesh(new BufferGeometry(), preexisting));
    cityScene.setOverlayDesaturation(true);
    expect(compiledFragment(preexisting)).toContain('uOverlayDesaturate)');

    // The embedded voxel lane adds meshes mid-play without CityScene.add().
    const late = new MeshLambertMaterial();
    cityScene.scene.add(new Mesh(new BufferGeometry(), late));
    (cityScene as unknown as PresentableCityScene).presentFrame(1_000);
    expect(compiledFragment(late)).toContain('uOverlayDesaturate)');
  });

  it('greys the background clear color only while overlay desaturation is on', () => {
    const cityScene = makeCityScene();
    cityScene.setDayFraction(0.5); // noon
    const colored = cityScene.scene.background as Color;
    expect(colored.r === colored.b && colored.r === colored.g).toBe(false);

    cityScene.setOverlayDesaturation(true);
    cityScene.setDayFraction(0.5);
    const grey = cityScene.scene.background as Color;
    expect(grey.r).toBeCloseTo(grey.g, 6);
    expect(grey.g).toBeCloseTo(grey.b, 6);
  });
});
