import { Color } from 'three';
import { cellHash01 } from './constants';
import {
  SIDEWALK_WIDTH,
  SIDEWALK_Y,
  TRAFFIC_SIGNAL_ACTIVE_GREEN,
  TRAFFIC_SIGNAL_ACTIVE_RED,
  TRAFFIC_SIGNAL_CORNER_INSET,
  TRAFFIC_SIGNAL_DIM_AMBER,
  TRAFFIC_SIGNAL_HOUSING_BOTTOM,
  TRAFFIC_SIGNAL_HOUSING_COLOR,
  TRAFFIC_SIGNAL_HOUSING_DEPTH,
  TRAFFIC_SIGNAL_HOUSING_TOP,
  TRAFFIC_SIGNAL_HOUSING_WIDTH,
  TRAFFIC_SIGNAL_INACTIVE_GREEN,
  TRAFFIC_SIGNAL_INACTIVE_RED,
  TRAFFIC_SIGNAL_LENS_DEPTH,
  TRAFFIC_SIGNAL_LENS_HALF_SIZE,
  TRAFFIC_SIGNAL_LENS_HEIGHTS,
  TRAFFIC_SIGNAL_POLE_COLOR,
  TRAFFIC_SIGNAL_POLE_HALF_WIDTH,
  TRAFFIC_SIGNAL_POLE_HEIGHT,
} from './road-streetscape-style';
import type { TerrainSurfaceView } from './terrain-surface';

export interface RoadNeighbors {
  w: boolean;
  e: boolean;
  n: boolean;
  s: boolean;
}

type RoadArm = keyof RoadNeighbors;

interface StreetscapeGeometryBuilder {
  surfacePatch(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    lift: number,
    surface: TerrainSurfaceView,
  ): number;
  coloredBox(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    color: Color,
  ): void;
}

export function addSidewalks(
  builder: StreetscapeGeometryBuilder,
  surface: TerrainSurfaceView,
  neighbors: RoadNeighbors,
  x: number,
  z: number,
): number {
  const horizontal = neighbors.w || neighbors.e;
  const vertical = neighbors.n || neighbors.s;
  const patch = (x0: number, z0: number, x1: number, z1: number): void => {
    builder.surfacePatch(x0, z0, x1, z1, SIDEWALK_Y, surface);
  };
  if (horizontal && vertical) {
    patch(x, z, x + SIDEWALK_WIDTH, z + SIDEWALK_WIDTH);
    patch(x + 1 - SIDEWALK_WIDTH, z, x + 1, z + SIDEWALK_WIDTH);
    patch(x, z + 1 - SIDEWALK_WIDTH, x + SIDEWALK_WIDTH, z + 1);
    patch(x + 1 - SIDEWALK_WIDTH, z + 1 - SIDEWALK_WIDTH, x + 1, z + 1);
    return 4;
  }
  if (horizontal) {
    patch(x, z, x + 1, z + SIDEWALK_WIDTH);
    patch(x, z + 1 - SIDEWALK_WIDTH, x + 1, z + 1);
    return 2;
  }
  if (vertical) {
    patch(x, z, x + SIDEWALK_WIDTH, z + 1);
    patch(x + 1 - SIDEWALK_WIDTH, z, x + 1, z + 1);
    return 2;
  }
  patch(x, z, x + 1, z + SIDEWALK_WIDTH);
  patch(x, z + 1 - SIDEWALK_WIDTH, x + 1, z + 1);
  patch(x, z + SIDEWALK_WIDTH, x + SIDEWALK_WIDTH, z + 1 - SIDEWALK_WIDTH);
  patch(x + 1 - SIDEWALK_WIDTH, z + SIDEWALK_WIDTH, x + 1, z + 1 - SIDEWALK_WIDTH);
  return 4;
}

export function addTrafficSignals(
  builder: StreetscapeGeometryBuilder,
  surface: TerrainSurfaceView,
  neighbors: RoadNeighbors,
  index: number,
  x: number,
  z: number,
): number {
  const arms = (Object.keys(neighbors) as RoadArm[]).filter((arm) => neighbors[arm]);
  if (arms.length < 3) return 0;
  const horizontalGreen = cellHash01(index) >= 0.5;
  for (const arm of arms) {
    addTrafficSignal(builder, surface, arm, horizontalGreen, x, z);
  }
  return arms.length;
}

function addTrafficSignal(
  builder: StreetscapeGeometryBuilder,
  surface: TerrainSurfaceView,
  arm: RoadArm,
  horizontalGreen: boolean,
  x: number,
  z: number,
): void {
  const inset = TRAFFIC_SIGNAL_CORNER_INSET;
  const [px, pz] = arm === 'w'
    ? [x + inset, z + 1 - inset]
    : arm === 'e'
      ? [x + 1 - inset, z + inset]
      : arm === 'n'
        ? [x + inset, z + inset]
        : [x + 1 - inset, z + 1 - inset];
  const base = surface.heightAt(px, pz) + SIDEWALK_Y;
  const poleHalf = TRAFFIC_SIGNAL_POLE_HALF_WIDTH;
  builder.coloredBox(
    px - poleHalf,
    base,
    pz - poleHalf,
    px + poleHalf,
    base + TRAFFIC_SIGNAL_POLE_HEIGHT,
    pz + poleHalf,
    new Color(TRAFFIC_SIGNAL_POLE_COLOR),
  );

  const horizontal = arm === 'w' || arm === 'e';
  const halfWidth = TRAFFIC_SIGNAL_HOUSING_WIDTH / 2;
  const halfDepth = TRAFFIC_SIGNAL_HOUSING_DEPTH / 2;
  const hx = horizontal ? halfDepth : halfWidth;
  const hz = horizontal ? halfWidth : halfDepth;
  builder.coloredBox(
    px - hx,
    base + TRAFFIC_SIGNAL_HOUSING_BOTTOM,
    pz - hz,
    px + hx,
    base + TRAFFIC_SIGNAL_HOUSING_TOP,
    pz + hz,
    new Color(TRAFFIC_SIGNAL_HOUSING_COLOR),
  );

  const green = horizontal === horizontalGreen;
  const lensColors = [
    green ? TRAFFIC_SIGNAL_INACTIVE_RED : TRAFFIC_SIGNAL_ACTIVE_RED,
    TRAFFIC_SIGNAL_DIM_AMBER,
    green ? TRAFFIC_SIGNAL_ACTIVE_GREEN : TRAFFIC_SIGNAL_INACTIVE_GREEN,
  ];
  for (let lens = 0; lens < lensColors.length; lens++) {
    addSignalLens(
      builder,
      arm,
      px,
      base + TRAFFIC_SIGNAL_LENS_HEIGHTS[lens],
      pz,
      new Color(lensColors[lens]),
    );
  }
}

function addSignalLens(
  builder: StreetscapeGeometryBuilder,
  arm: RoadArm,
  x: number,
  y: number,
  z: number,
  color: Color,
): void {
  const half = TRAFFIC_SIGNAL_LENS_HALF_SIZE;
  const depth = TRAFFIC_SIGNAL_HOUSING_DEPTH / 2 + TRAFFIC_SIGNAL_LENS_DEPTH;
  if (arm === 'w' || arm === 'e') {
    const face = x + (arm === 'w' ? -depth : depth);
    builder.coloredBox(
      face - TRAFFIC_SIGNAL_LENS_DEPTH,
      y - half,
      z - half,
      face + TRAFFIC_SIGNAL_LENS_DEPTH,
      y + half,
      z + half,
      color,
    );
    return;
  }
  const face = z + (arm === 'n' ? -depth : depth);
  builder.coloredBox(
    x - half,
    y - half,
    face - TRAFFIC_SIGNAL_LENS_DEPTH,
    x + half,
    y + half,
    face + TRAFFIC_SIGNAL_LENS_DEPTH,
    color,
  );
}
