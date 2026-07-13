import { Color } from 'three';
import {
  WATER_DEEP_COLOR,
  WATER_DEEP_ELEVATION_DELTA,
  WATER_MID_COLOR,
  WATER_MID_DEPTH,
  WATER_SHALLOW_COLOR,
} from './constants';

export interface WaterDepthData {
  width: number;
  height: number;
  elevation: Float32Array;
  seaLevel: number;
  water: Uint8Array;
}

const shallowColor = new Color(WATER_SHALLOW_COLOR);
const middleColor = new Color(WATER_MID_COLOR);
const deepColor = new Color(WATER_DEEP_COLOR);

/** Converts the seeded seabed elevation into renderer-owned [0,1] depth. */
export function waterDepth01(elevation: number, seaLevel: number): number {
  if (!Number.isFinite(elevation) || !Number.isFinite(seaLevel)) return 0;
  return Math.min(Math.max((seaLevel - elevation) / WATER_DEEP_ELEVATION_DELTA, 0), 1);
}

/**
 * Builds one continuous depth sample per water-grid corner. Shared corners
 * average their adjacent water cells; any adjacent land pins the bank to the
 * shallow endpoint so lake edges stay bright and readable.
 */
export function buildWaterCornerDepths(data: WaterDepthData): Float32Array {
  const stride = data.width + 1;
  const depths = new Float32Array(stride * (data.height + 1));
  for (let z = 0; z <= data.height; z++) {
    for (let x = 0; x <= data.width; x++) {
      let sum = 0;
      let count = 0;
      let touchesLand = false;
      for (let dz = -1; dz <= 0; dz++) {
        for (let dx = -1; dx <= 0; dx++) {
          const cellX = x + dx;
          const cellZ = z + dz;
          if (cellX < 0 || cellZ < 0 || cellX >= data.width || cellZ >= data.height) continue;
          const index = cellZ * data.width + cellX;
          if (data.water[index] === 1) {
            sum += waterDepth01(data.elevation[index] ?? data.seaLevel, data.seaLevel);
            count++;
          } else {
            touchesLand = true;
          }
        }
      }
      depths[z * stride + x] = touchesLand || count === 0 ? 0 : sum / count;
    }
  }
  return depths;
}

/** Writes the friendly three-stop bathymetry ramp into a reusable color. */
export function waterDepthColor(depth: number, target: Color): Color {
  const normalized = Math.min(Math.max(depth, 0), 1);
  if (normalized <= WATER_MID_DEPTH) {
    return target.lerpColors(shallowColor, middleColor, normalized / WATER_MID_DEPTH);
  }
  return target.lerpColors(
    middleColor,
    deepColor,
    (normalized - WATER_MID_DEPTH) / (1 - WATER_MID_DEPTH),
  );
}
