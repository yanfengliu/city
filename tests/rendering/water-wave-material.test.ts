import { describe, expect, it } from 'vitest';
import type { WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import {
  WATER_WAVE_NORMAL_STRENGTH,
  WATER_WAVE_PRIMARY,
  WATER_WAVE_SECONDARY,
  WATER_WAVE_TIME_CYCLE_SECONDS,
  WATER_WIND_DIRECTION,
} from '../../src/rendering/constants';
import {
  WaterWaveMaterial,
  wrapWaterWaveTime,
  waterWaveHeightAt,
  waterWaveSlopeAt,
} from '../../src/rendering/water-wave-material';

const shaderFixture = (): WebGLProgramParametersWithUniforms => ({
  uniforms: {},
  vertexShader: [
    '#include <common>',
    'void main() {',
    '  #include <beginnormal_vertex>',
    '  #include <normal_vertex>',
    '  #include <begin_vertex>',
    '}',
  ].join('\n'),
}) as unknown as WebGLProgramParametersWithUniforms;

/**
 * For decorative motion over a surface that is mechanically fixed, start with a
 * renderer-time normal field and add geometry only when collision, picking, and
 * the boundary seams are explicitly updated too. GPU vertex displacement here
 * would make the water a player sees diverge from the flat plane the CPU picks
 * against, and would expose the fixed shoreline skirts at every wave trough.
 *
 * Two details the shader has to get right: restore the flat normal before
 * Three.js applies receiver-shadow bias, or the shadow edge ripples with the
 * lighting; and drive the animation from the scene's own presentation clock
 * rather than a private wall clock inside the material, or rAF and the
 * screenshot path disagree about what time it is.
 */
describe('wind-driven water wave material', () => {
  it('pins a gentle prevailing wind and two readable wave bands', () => {
    expect(WATER_WIND_DIRECTION).toEqual({ x: 0.82, z: 0.57 });
    expect(WATER_WAVE_PRIMARY).toEqual({
      amplitude: 0.026,
      waveNumber: 0.62,
      angularSpeed: 1.05,
    });
    expect(WATER_WAVE_SECONDARY).toEqual({
      amplitude: 0.012,
      waveNumber: 1.18,
      angularSpeed: 1.62,
      crosswindMix: 0.62,
      phase: 1.7,
    });
    expect(WATER_WAVE_NORMAL_STRENGTH).toBe(4);
    expect(WATER_WAVE_TIME_CYCLE_SECONDS).toBeCloseTo(209.4395102, 6);
  });

  it('keeps the virtual wave field bounded, moving, and seamless when time wraps', () => {
    const maxAmplitude = WATER_WAVE_PRIMARY.amplitude + WATER_WAVE_SECONDARY.amplitude;
    let observedMotion = 0;
    for (let z = 0; z <= 16; z += 2) {
      for (let x = 0; x <= 16; x += 2) {
        const first = waterWaveHeightAt(x, z, 1.25);
        const second = waterWaveHeightAt(x, z, 1.75);
        expect(Math.abs(first)).toBeLessThanOrEqual(maxAmplitude + 1e-12);
        expect(Math.abs(second)).toBeLessThanOrEqual(maxAmplitude + 1e-12);
        observedMotion = Math.max(observedMotion, Math.abs(second - first));
      }
    }
    expect(observedMotion).toBeGreaterThan(0.01);
    expect(wrapWaterWaveTime(WATER_WAVE_TIME_CYCLE_SECONDS)).toBeCloseTo(0, 12);
    expect(waterWaveHeightAt(7, 11, 2.5 + WATER_WAVE_TIME_CYCLE_SECONDS))
      .toBeCloseTo(waterWaveHeightAt(7, 11, 2.5), 10);
  });

  it('derives lighting normals from the same analytic wave slope', () => {
    const x = 7.25;
    const z = 11.5;
    const time = 2.75;
    const epsilon = 1e-4;
    const slope = waterWaveSlopeAt(x, z, time);
    const dx =
      (waterWaveHeightAt(x + epsilon, z, time) -
        waterWaveHeightAt(x - epsilon, z, time)) /
      (2 * epsilon);
    const dz =
      (waterWaveHeightAt(x, z + epsilon, time) -
        waterWaveHeightAt(x, z - epsilon, time)) /
      (2 * epsilon);

    expect(slope.x).toBeCloseTo(dx, 6);
    expect(slope.z).toBeCloseTo(dz, 6);
  });

  it('injects time-driven wave normals without displacing the flat geometry', () => {
    const material = new WaterWaveMaterial();
    material.setWaveTime(3.5);
    const shader = shaderFixture();

    material.onBeforeCompile(shader, undefined as unknown as WebGLRenderer);

    expect(shader.uniforms.waterWaveTime?.value).toBe(3.5);
    expect(shader.vertexShader).toContain('uniform vec2 waterWindDirection;');
    expect(shader.vertexShader).toContain('waterSlope *= 4.0;');
    expect(shader.vertexShader).toContain('objectNormal = normalize');
    expect(shader.vertexShader).toContain('transformedNormal = normalMatrix * vec3(normal);');
    expect(shader.vertexShader.indexOf('objectNormal = normalize'))
      .toBeLessThan(shader.vertexShader.indexOf('#include <normal_vertex>'));
    expect(shader.vertexShader.indexOf('#include <normal_vertex>'))
      .toBeLessThan(shader.vertexShader.indexOf('transformedNormal = normalMatrix'));
    expect(shader.vertexShader).not.toContain('transformed.y +=');
    expect(material.vertexColors).toBe(true);
    expect(material.color.getHex()).toBe(0xffffff);

    material.setWaveTime(4.25);
    expect(shader.uniforms.waterWaveTime?.value).toBe(4.25);

    const recompiledShader = shaderFixture();
    material.onBeforeCompile(recompiledShader, undefined as unknown as WebGLRenderer);
    expect(recompiledShader.uniforms.waterWaveTime?.value).toBe(4.25);
    material.setWaveTime(5.5);
    expect(shader.uniforms.waterWaveTime?.value).toBe(5.5);
    expect(recompiledShader.uniforms.waterWaveTime?.value).toBe(5.5);
  });

  it('fails clearly when a Three.js upgrade removes a required shader hook', () => {
    const material = new WaterWaveMaterial();
    const shader = {
      ...shaderFixture(),
      vertexShader: '#include <common>\nvoid main() {}',
    } as WebGLProgramParametersWithUniforms;

    expect(() =>
      material.onBeforeCompile(shader, undefined as unknown as WebGLRenderer),
    ).toThrow('Water wave shader hook missing: #include <beginnormal_vertex>');
  });
});
