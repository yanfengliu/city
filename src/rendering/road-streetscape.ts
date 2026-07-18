import { Color } from 'three';
import {
  SIDEWALK_WIDTH,
  SIDEWALK_Y,
  TRAFFIC_SIGNAL_CORNER_INSET,
  TRAFFIC_SIGNAL_HOUSING_BOTTOM,
  TRAFFIC_SIGNAL_HOUSING_COLOR,
  TRAFFIC_SIGNAL_HOUSING_DEPTH,
  TRAFFIC_SIGNAL_HOUSING_TOP,
  TRAFFIC_SIGNAL_HOUSING_WIDTH,
  TRAFFIC_SIGNAL_LENS_DEPTH,
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
    let count = 4;
    if (!neighbors.n) {
      patch(x + SIDEWALK_WIDTH, z, x + 1 - SIDEWALK_WIDTH, z + SIDEWALK_WIDTH);
      count++;
    }
    if (!neighbors.s) {
      patch(x + SIDEWALK_WIDTH, z + 1 - SIDEWALK_WIDTH, x + 1 - SIDEWALK_WIDTH, z + 1);
      count++;
    }
    if (!neighbors.w) {
      patch(x, z + SIDEWALK_WIDTH, x + SIDEWALK_WIDTH, z + 1 - SIDEWALK_WIDTH);
      count++;
    }
    if (!neighbors.e) {
      patch(x + 1 - SIDEWALK_WIDTH, z + SIDEWALK_WIDTH, x + 1, z + 1 - SIDEWALK_WIDTH);
      count++;
    }
    return count;
  }
  if (horizontal) {
    patch(x, z, x + 1, z + SIDEWALK_WIDTH);
    patch(x, z + 1 - SIDEWALK_WIDTH, x + 1, z + 1);
    let count = 2;
    if (!neighbors.w) {
      patch(x, z + SIDEWALK_WIDTH, x + SIDEWALK_WIDTH, z + 1 - SIDEWALK_WIDTH);
      count++;
    }
    if (!neighbors.e) {
      patch(x + 1 - SIDEWALK_WIDTH, z + SIDEWALK_WIDTH, x + 1, z + 1 - SIDEWALK_WIDTH);
      count++;
    }
    return count;
  }
  if (vertical) {
    patch(x, z, x + SIDEWALK_WIDTH, z + 1);
    patch(x + 1 - SIDEWALK_WIDTH, z, x + 1, z + 1);
    let count = 2;
    if (!neighbors.n) {
      patch(x + SIDEWALK_WIDTH, z, x + 1 - SIDEWALK_WIDTH, z + SIDEWALK_WIDTH);
      count++;
    }
    if (!neighbors.s) {
      patch(x + SIDEWALK_WIDTH, z + 1 - SIDEWALK_WIDTH, x + 1 - SIDEWALK_WIDTH, z + 1);
      count++;
    }
    return count;
  }
  patch(x, z, x + 1, z + SIDEWALK_WIDTH);
  patch(x, z + 1 - SIDEWALK_WIDTH, x + 1, z + 1);
  patch(x, z + SIDEWALK_WIDTH, x + SIDEWALK_WIDTH, z + 1 - SIDEWALK_WIDTH);
  patch(x + 1 - SIDEWALK_WIDTH, z + SIDEWALK_WIDTH, x + 1, z + 1 - SIDEWALK_WIDTH);
  return 4;
}

/**
 * One live signal lens: a small light face on a junction fixture, colored per
 * frame from `signalPhase(tick, node)` by SignalLensesView. The streetscape
 * bakes only the static pole + housing; lens positions are emitted as data so
 * the light state never forces a road-geometry rebuild.
 */
export interface SignalLensDescriptor {
  /** Junction node cell index — the signalPhase key. */
  node: number;
  /** Axis served by this head: w/e arms face east–west traffic. */
  axis: 'ns' | 'ew';
  /** Stack slot: 0 red, 1 amber, 2 green. */
  slot: number;
  /** Lens box center. */
  x: number;
  y: number;
  z: number;
  /** Which arm the head hangs on (orients the box thickness). */
  arm: RoadArm;
}

export function addTrafficSignals(
  builder: StreetscapeGeometryBuilder,
  surface: TerrainSurfaceView,
  neighbors: RoadNeighbors,
  index: number,
  x: number,
  z: number,
  lenses: SignalLensDescriptor[],
): number {
  const arms = (Object.keys(neighbors) as RoadArm[]).filter((arm) => neighbors[arm]);
  if (arms.length < 3) return 0;
  for (const arm of arms) {
    addTrafficSignal(builder, surface, arm, index, x, z, lenses);
  }
  return arms.length;
}

function addTrafficSignal(
  builder: StreetscapeGeometryBuilder,
  surface: TerrainSurfaceView,
  arm: RoadArm,
  index: number,
  x: number,
  z: number,
  lenses: SignalLensDescriptor[],
): void {
  const inset = TRAFFIC_SIGNAL_CORNER_INSET;
  const [px, pz] = arm === 'w'
    ? [x + inset, z + 1 - inset]
    : arm === 'e'
      ? [x + 1 - inset, z + inset]
      : arm === 'n'
        ? [x + inset, z + inset]
        : [x + 1 - inset, z + 1 - inset];
  const poleBase = surface.heightAt(px, pz) + SIDEWALK_Y;
  const fixtureBase = surface.footprintRange(x, z, 1, 1).max + SIDEWALK_Y;
  const poleHalf = TRAFFIC_SIGNAL_POLE_HALF_WIDTH;
  builder.coloredBox(
    px - poleHalf,
    poleBase,
    pz - poleHalf,
    px + poleHalf,
    fixtureBase + TRAFFIC_SIGNAL_POLE_HEIGHT,
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
    fixtureBase + TRAFFIC_SIGNAL_HOUSING_BOTTOM,
    pz - hz,
    px + hx,
    fixtureBase + TRAFFIC_SIGNAL_HOUSING_TOP,
    pz + hz,
    new Color(TRAFFIC_SIGNAL_HOUSING_COLOR),
  );

  const depth = TRAFFIC_SIGNAL_HOUSING_DEPTH / 2 + TRAFFIC_SIGNAL_LENS_DEPTH;
  for (let slot = 0; slot < TRAFFIC_SIGNAL_LENS_HEIGHTS.length; slot++) {
    lenses.push({
      node: index,
      axis: horizontal ? 'ew' : 'ns',
      slot,
      x: horizontal ? px + (arm === 'w' ? -depth : depth) : px,
      y: fixtureBase + TRAFFIC_SIGNAL_LENS_HEIGHTS[slot],
      z: horizontal ? pz : pz + (arm === 'n' ? -depth : depth),
      arm,
    });
  }
}
