import { describe, expect, it } from 'vitest';
import {
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Material,
} from 'three';
import {
  desaturateToLuminance,
  markOverlayKeepColor,
  OverlayDesaturation,
} from '../../src/rendering/desaturation';
import { WaterWaveMaterial } from '../../src/rendering/water-wave-material';

/** Fragment tail shared by every three r18x built-in material. */
const BUILTIN_FRAGMENT = `void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`;

/** Custom shaders (the sky dome) end at colorspace with no dithering hook. */
const CUSTOM_FRAGMENT = `void main() {
	gl_FragColor = vec4(mix(horizonColor, topColor, 0.5), 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

/** Vertex source carrying the hooks WaterWaveMaterial's own injection needs. */
const BUILTIN_VERTEX = `#include <common>
void main() {
	#include <beginnormal_vertex>
	#include <normal_vertex>
}`;

interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function compile(material: Material, fragmentShader = BUILTIN_FRAGMENT): FakeShader {
  const shader: FakeShader = { uniforms: {}, vertexShader: BUILTIN_VERTEX, fragmentShader };
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

function meshOf(material: Material): Mesh {
  return new Mesh(new BufferGeometry(), material);
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('OverlayDesaturation', () => {
  it('injects a shared desaturation uniform ahead of the dithering hook', () => {
    const desat = new OverlayDesaturation();
    const a = new MeshLambertMaterial();
    const b = new MeshBasicMaterial();
    desat.patchObject(meshOf(a));
    desat.patchObject(meshOf(b));

    const shaderA = compile(a);
    const shaderB = compile(b);
    expect(shaderA.fragmentShader).toContain('uniform float uOverlayDesaturate;');
    const mixAt = shaderA.fragmentShader.indexOf('uOverlayDesaturate)');
    const ditherAt = shaderA.fragmentShader.indexOf('#include <dithering_fragment>');
    expect(mixAt).toBeGreaterThan(-1);
    expect(ditherAt).toBeGreaterThan(mixAt);
    // One uniform object across all materials: a single toggle drives every program.
    expect(shaderA.uniforms.uOverlayDesaturate).toBeDefined();
    expect(shaderB.uniforms.uOverlayDesaturate).toBe(shaderA.uniforms.uOverlayDesaturate);
  });

  it('falls back to the colorspace hook for custom shaders without dithering', () => {
    const desat = new OverlayDesaturation();
    const material = new MeshBasicMaterial();
    desat.patchObject(meshOf(material));

    const shader = compile(material, CUSTOM_FRAGMENT);
    const mixAt = shader.fragmentShader.indexOf('uOverlayDesaturate)');
    const colorspaceAt = shader.fragmentShader.indexOf('#include <colorspace_fragment>');
    expect(mixAt).toBeGreaterThan(colorspaceAt);
  });

  it('leaves shaders without either hook untouched', () => {
    const desat = new OverlayDesaturation();
    const material = new MeshBasicMaterial();
    desat.patchObject(meshOf(material));

    const bare = 'void main() { gl_FragColor = vec4(1.0); }';
    const shader = compile(material, bare);
    expect(shader.fragmentShader).toBe(bare);
    expect(shader.uniforms.uOverlayDesaturate).toBeUndefined();
  });

  it("composes with a material's existing onBeforeCompile instead of replacing it", () => {
    const desat = new OverlayDesaturation();
    const water = new WaterWaveMaterial();
    desat.patchObject(meshOf(water));

    const shader = compile(water);
    // Both the wave injection and the desaturation injection took effect.
    expect(shader.vertexShader).toContain('waterWaveSlope');
    expect(shader.uniforms.waterWaveTime).toBeDefined();
    expect(shader.fragmentShader).toContain('uOverlayDesaturate)');
  });

  it('extends customProgramCacheKey so patched programs never collide with unpatched ones', () => {
    const desat = new OverlayDesaturation();
    const patched = new MeshLambertMaterial();
    desat.patchObject(meshOf(patched));
    expect(patched.customProgramCacheKey()).not.toBe(new MeshLambertMaterial().customProgramCacheKey());

    const water = new WaterWaveMaterial();
    desat.patchObject(meshOf(water));
    expect(water.customProgramCacheKey()).toContain('water-waves-v2');
    expect(water.customProgramCacheKey()).not.toBe(new WaterWaveMaterial().customProgramCacheKey());
  });

  it('skips subtrees marked to keep their color (overlays, ghosts, FX)', () => {
    const desat = new OverlayDesaturation();
    const overlayMaterial = new MeshBasicMaterial();
    const worldMaterial = new MeshLambertMaterial();
    const overlayGroup = new Group();
    overlayGroup.add(meshOf(overlayMaterial));
    markOverlayKeepColor(overlayGroup);
    const root = new Group();
    root.add(overlayGroup, meshOf(worldMaterial));

    desat.patchObject(root);
    expect(compile(worldMaterial).fragmentShader).toContain('uOverlayDesaturate)');
    const overlayShader = compile(overlayMaterial);
    expect(overlayShader.fragmentShader).not.toContain('uOverlayDesaturate');
    expect(overlayShader.uniforms.uOverlayDesaturate).toBeUndefined();
  });

  it('patches each material once even when traversed repeatedly', () => {
    const desat = new OverlayDesaturation();
    const material = new MeshLambertMaterial();
    const mesh = meshOf(material);
    desat.patchObject(mesh);
    desat.patchObject(mesh);

    const shader = compile(material);
    expect(count(shader.fragmentShader, 'uniform float uOverlayDesaturate;')).toBe(1);
    expect(count(shader.fragmentShader, 'uOverlayDesaturate)')).toBe(1);
  });

  it('recompiles already-live materials by bumping their version', () => {
    const desat = new OverlayDesaturation();
    const material = new MeshLambertMaterial();
    const before = material.version;
    desat.patchObject(meshOf(material));
    expect(material.version).toBe(before + 1);
  });

  it('drives every patched program from one enabled flag', () => {
    const desat = new OverlayDesaturation();
    const material = new MeshLambertMaterial();
    desat.patchObject(meshOf(material));
    const shader = compile(material);
    const uniform = shader.uniforms.uOverlayDesaturate as { value: number };

    expect(desat.enabled).toBe(false);
    expect(uniform.value).toBe(0);
    desat.setEnabled(true);
    expect(desat.enabled).toBe(true);
    expect(uniform.value).toBe(1);
    desat.setEnabled(false);
    expect(uniform.value).toBe(0);
  });
});

describe('desaturateToLuminance', () => {
  it('collapses a color to its rec709 luminance in place', () => {
    const color = new Color();
    color.r = 0.5;
    color.g = 0.25;
    color.b = 1;
    desaturateToLuminance(color);
    const expected = 0.2126 * 0.5 + 0.7152 * 0.25 + 0.0722 * 1;
    expect(color.r).toBeCloseTo(expected, 6);
    expect(color.g).toBeCloseTo(expected, 6);
    expect(color.b).toBeCloseTo(expected, 6);
  });
});
