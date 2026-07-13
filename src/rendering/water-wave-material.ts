import {
  MeshStandardMaterial,
  Vector2,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import {
  WATER_WAVE_NORMAL_STRENGTH,
  WATER_WAVE_PRIMARY,
  WATER_WAVE_SECONDARY,
  WATER_WAVE_TIME_CYCLE_SECONDS,
  WATER_WIND_DIRECTION,
} from './constants';

interface WaveDirection {
  x: number;
  z: number;
}

const normalizeDirection = (x: number, z: number): WaveDirection => {
  const length = Math.hypot(x, z);
  return length > Number.EPSILON ? { x: x / length, z: z / length } : { x: 1, z: 0 };
};

const windDirection = normalizeDirection(WATER_WIND_DIRECTION.x, WATER_WIND_DIRECTION.z);
const secondaryDirection = normalizeDirection(
  windDirection.x - windDirection.z * WATER_WAVE_SECONDARY.crosswindMix,
  windDirection.z + windDirection.x * WATER_WAVE_SECONDARY.crosswindMix,
);

const glslFloat = (value: number): string =>
  Number.isInteger(value) ? `${value}.0` : String(value);

const WAVE_SHADER_DECLARATIONS = `
uniform float waterWaveTime;
uniform vec2 waterWindDirection;
uniform vec2 waterSecondaryDirection;

vec2 waterWaveSlope(vec2 xz) {
  float primaryPhase = dot(xz, waterWindDirection) * ${glslFloat(WATER_WAVE_PRIMARY.waveNumber)}
    - waterWaveTime * ${glslFloat(WATER_WAVE_PRIMARY.angularSpeed)};
  float secondaryPhase = dot(xz, waterSecondaryDirection) * ${glslFloat(WATER_WAVE_SECONDARY.waveNumber)}
    - waterWaveTime * ${glslFloat(WATER_WAVE_SECONDARY.angularSpeed)}
    + ${glslFloat(WATER_WAVE_SECONDARY.phase)};
  return waterWindDirection
      * (${glslFloat(WATER_WAVE_PRIMARY.amplitude * WATER_WAVE_PRIMARY.waveNumber)} * cos(primaryPhase))
    + waterSecondaryDirection
      * (${glslFloat(WATER_WAVE_SECONDARY.amplitude * WATER_WAVE_SECONDARY.waveNumber)} * cos(secondaryPhase));
}
`;

const injectAfter = (source: string, marker: string, addition: string): string => {
  if (!source.includes(marker)) {
    throw new Error(`Water wave shader hook missing: ${marker}`);
  }
  return source.replace(marker, `${marker}\n${addition}`);
};

const phaseAt = (
  x: number,
  z: number,
  timeSeconds: number,
  direction: WaveDirection,
  waveNumber: number,
  angularSpeed: number,
  phase = 0,
): number =>
  (x * direction.x + z * direction.z) * waveNumber - timeSeconds * angularSpeed + phase;

export function wrapWaterWaveTime(timeSeconds: number): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  const positive = Math.max(0, timeSeconds);
  return positive % WATER_WAVE_TIME_CYCLE_SECONDS;
}

/** Virtual height field whose derivative drives the shader normal animation. */
export function waterWaveHeightAt(x: number, z: number, timeSeconds: number): number {
  const waveTime = wrapWaterWaveTime(timeSeconds);
  const primaryPhase = phaseAt(
    x,
    z,
    waveTime,
    windDirection,
    WATER_WAVE_PRIMARY.waveNumber,
    WATER_WAVE_PRIMARY.angularSpeed,
  );
  const secondaryPhase = phaseAt(
    x,
    z,
    waveTime,
    secondaryDirection,
    WATER_WAVE_SECONDARY.waveNumber,
    WATER_WAVE_SECONDARY.angularSpeed,
    WATER_WAVE_SECONDARY.phase,
  );
  return (
    Math.sin(primaryPhase) * WATER_WAVE_PRIMARY.amplitude +
    Math.sin(secondaryPhase) * WATER_WAVE_SECONDARY.amplitude
  );
}

/** Analytic base gradient; the shader applies WATER_WAVE_NORMAL_STRENGTH to it. */
export function waterWaveSlopeAt(
  x: number,
  z: number,
  timeSeconds: number,
): WaveDirection {
  const waveTime = wrapWaterWaveTime(timeSeconds);
  const primaryPhase = phaseAt(
    x,
    z,
    waveTime,
    windDirection,
    WATER_WAVE_PRIMARY.waveNumber,
    WATER_WAVE_PRIMARY.angularSpeed,
  );
  const secondaryPhase = phaseAt(
    x,
    z,
    waveTime,
    secondaryDirection,
    WATER_WAVE_SECONDARY.waveNumber,
    WATER_WAVE_SECONDARY.angularSpeed,
    WATER_WAVE_SECONDARY.phase,
  );
  const primarySlope =
    WATER_WAVE_PRIMARY.amplitude * WATER_WAVE_PRIMARY.waveNumber * Math.cos(primaryPhase);
  const secondarySlope =
    WATER_WAVE_SECONDARY.amplitude *
    WATER_WAVE_SECONDARY.waveNumber *
    Math.cos(secondaryPhase);
  return {
    x: windDirection.x * primarySlope + secondaryDirection.x * secondarySlope,
    z: windDirection.z * primarySlope + secondaryDirection.z * secondarySlope,
  };
}

/**
 * Standard-lit water with GPU-only normal ripples. The source geometry,
 * bathymetry colors, picking plane, simulation, and save state remain static.
 */
export class WaterWaveMaterial extends MeshStandardMaterial {
  private readonly waveTime = { value: 0 };
  private readonly primaryDirectionUniform = {
    value: new Vector2(windDirection.x, windDirection.z),
  };
  private readonly secondaryDirectionUniform = {
    value: new Vector2(secondaryDirection.x, secondaryDirection.z),
  };

  constructor() {
    super({ vertexColors: true, roughness: 0.28, metalness: 0 });
    this.name = 'water-wave-material';
    this.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
      shader.uniforms.waterWaveTime = this.waveTime;
      shader.uniforms.waterWindDirection = this.primaryDirectionUniform;
      shader.uniforms.waterSecondaryDirection = this.secondaryDirectionUniform;
      let vertexShader = injectAfter(
        shader.vertexShader,
        '#include <common>',
        WAVE_SHADER_DECLARATIONS,
      );
      vertexShader = injectAfter(
        vertexShader,
        '#include <beginnormal_vertex>',
        `vec2 waterSlope = waterWaveSlope(position.xz);
waterSlope *= ${glslFloat(WATER_WAVE_NORMAL_STRENGTH)};
objectNormal = normalize(vec3(-waterSlope.x, 1.0, -waterSlope.y));`,
      );
      shader.vertexShader = injectAfter(
        vertexShader,
        '#include <normal_vertex>',
        `// Lighting has captured vNormal; keep received-shadow bias on the flat plane.
transformedNormal = normalMatrix * vec3(normal);`,
      );
    };
  }

  setWaveTime(timeSeconds: number): void {
    this.waveTime.value = wrapWaterWaveTime(timeSeconds);
  }

  get waveTimeSeconds(): number {
    return this.waveTime.value;
  }

  override customProgramCacheKey(): string {
    return [
      'water-waves-v2',
      WATER_WAVE_PRIMARY.amplitude,
      WATER_WAVE_PRIMARY.waveNumber,
      WATER_WAVE_PRIMARY.angularSpeed,
      WATER_WAVE_SECONDARY.amplitude,
      WATER_WAVE_SECONDARY.waveNumber,
      WATER_WAVE_SECONDARY.angularSpeed,
      WATER_WAVE_SECONDARY.crosswindMix,
      WATER_WAVE_SECONDARY.phase,
      WATER_WAVE_NORMAL_STRENGTH,
      WATER_WAVE_TIME_CYCLE_SECONDS,
    ].join(':');
  }
}
