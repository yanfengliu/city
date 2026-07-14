import { describe, expect, it } from 'vitest';
import { Color, Mesh, MeshLambertMaterial } from 'three';
import {
  ROAD_COLOR,
  ROAD_DETAIL_END_INSET,
  ROAD_DETAIL_SIDE_INSET,
  ROAD_DETAIL_Y,
  ROAD_LANE_MARKING_LENGTH,
  ROAD_LANE_MARKING_WIDTH,
  ROAD_LANE_MARKING_Y,
  ROAD_SURFACE_Y,
  TRAFFIC_OVERLAY_Y,
  PEDESTRIAN_BODY,
  PEDESTRIAN_CURB_OFFSET,
  PEDESTRIAN_HEAD,
} from '../../src/rendering/constants';
import {
  PEDESTRIAN_MAX_HEIGHT_SCALE,
  PEDESTRIAN_MAX_WIDTH_SCALE,
  PEDESTRIAN_Y,
} from '../../src/rendering/pedestrian-style';
import { RoadsView } from '../../src/rendering/roads-mesh';
import {
  SIDEWALK_WIDTH,
  SIDEWALK_Y,
  TRAFFIC_SIGNAL_ACTIVE_GREEN,
  TRAFFIC_SIGNAL_ACTIVE_RED,
  TRAFFIC_SIGNAL_CORNER_INSET,
  TRAFFIC_SIGNAL_HOUSING_BOTTOM,
  TRAFFIC_SIGNAL_HOUSING_COLOR,
  TRAFFIC_SIGNAL_POLE_HALF_WIDTH,
} from '../../src/rendering/road-streetscape-style';
import { TerrainSurface } from '../../src/rendering/terrain-surface';

const mesh = (view: RoadsView, name: string): Mesh => {
  const child = view.group.getObjectByName(name);
  expect(child).toBeInstanceOf(Mesh);
  return child as Mesh;
};

const expectClose = (actual: number, expected: number): void => {
  expect(actual).toBeCloseTo(expected, 5);
};

describe('RoadsView', () => {
  it('drapes road vertices over the shared terrain surface', () => {
    const view = new RoadsView(10);
    const surface = new TerrainSurface({
      width: 10,
      height: 10,
      elevation: new Float32Array(100).fill(0.85),
      seaLevel: 0.35,
      water: new Uint8Array(100),
    });
    view.setTerrainSurface(surface);
    view.setWater(new Uint8Array(100));
    view.update([11]);

    const positions = mesh(view, 'road-surface').geometry.getAttribute('position').array as Float32Array;
    expectClose(positions[1], surface.maxHeight + ROAD_SURFACE_Y);
  });

  it('keeps a named inset surface-detail layer synchronized with ordinary land roads', () => {
    expect(TRAFFIC_OVERLAY_Y - ROAD_DETAIL_Y).toBeGreaterThanOrEqual(0.004);

    const highwayCells = new Set([11]);
    const water = new Uint8Array(40);
    water[12] = 1;
    const view = new RoadsView(10, highwayCells);

    view.setWater(water);
    view.update([10, 11, 12, 13]);

    const roadMesh = mesh(view, 'road-surface');
    const detailMesh = mesh(view, 'road-surface-details');

    expect(roadMesh.geometry.getAttribute('position').count).toBe(8);
    expect(detailMesh.geometry.getAttribute('position').count).toBe(16);

    const positions = detailMesh.geometry.getAttribute('position').array as Float32Array;
    const firstDetailX = Array.from({ length: 8 }, (_, i) => positions[i * 3]);
    const firstDetailY = Array.from({ length: 8 }, (_, i) => positions[i * 3 + 1]);
    const firstDetailZ = Array.from({ length: 8 }, (_, i) => positions[i * 3 + 2]);
    expectClose(Math.min(...firstDetailX), ROAD_DETAIL_SIDE_INSET);
    expectClose(Math.max(...firstDetailX), 1 - ROAD_DETAIL_SIDE_INSET);
    expect(firstDetailY.every((value) => Math.abs(value - ROAD_DETAIL_Y) < 1e-5)).toBe(true);
    expectClose(Math.min(...firstDetailZ), 1 + ROAD_DETAIL_END_INSET);
    expectClose(Math.max(...firstDetailZ), 2 - ROAD_DETAIL_END_INSET);

    const colorAttribute = detailMesh.geometry.getAttribute('color');
    expect(colorAttribute).toBeDefined();
    const colors = colorAttribute.array as Float32Array;
    expect(colors.length).toBe(48);
    expect(colors[0]).not.toBe(colors[24]);

    view.update([11, 12]);

    expect(roadMesh.visible).toBe(false);
    expect(detailMesh.visible).toBe(false);
  });

  it('renders modern asphalt roads with a synchronized lane-marking layer', () => {
    expect(ROAD_LANE_MARKING_Y - ROAD_DETAIL_Y).toBeGreaterThanOrEqual(0.002);
    expect(TRAFFIC_OVERLAY_Y - ROAD_LANE_MARKING_Y).toBeGreaterThanOrEqual(0.004);

    const view = new RoadsView(10);
    view.setWater(new Uint8Array(100));
    view.update([21, 31, 41]);

    const roadMesh = mesh(view, 'road-surface');
    const laneMesh = mesh(view, 'road-lane-markings');

    expect(roadMesh.material).toBeInstanceOf(MeshLambertMaterial);
    expect((roadMesh.material as MeshLambertMaterial).color.getHex()).toBe(ROAD_COLOR);
    expect(laneMesh.geometry.getAttribute('position').count).toBe(24);

    const positions = laneMesh.geometry.getAttribute('position').array as Float32Array;
    const x0 = 1.5 - ROAD_LANE_MARKING_WIDTH / 2;
    const x1 = 1.5 + ROAD_LANE_MARKING_WIDTH / 2;
    const z0 = 2.5 - ROAD_LANE_MARKING_LENGTH / 2;
    const z1 = 2.5 + ROAD_LANE_MARKING_LENGTH / 2;
    const firstLaneX = Array.from({ length: 8 }, (_, i) => positions[i * 3]);
    const firstLaneY = Array.from({ length: 8 }, (_, i) => positions[i * 3 + 1]);
    const firstLaneZ = Array.from({ length: 8 }, (_, i) => positions[i * 3 + 2]);
    expectClose(Math.min(...firstLaneX), x0);
    expectClose(Math.max(...firstLaneX), x1);
    expect(firstLaneY.every((value) => Math.abs(value - ROAD_LANE_MARKING_Y) < 1e-5)).toBe(true);
    expectClose(Math.min(...firstLaneZ), z0);
    expectClose(Math.max(...firstLaneZ), z1);

    view.update([]);

    expect(roadMesh.visible).toBe(false);
    expect(laneMesh.visible).toBe(false);
  });

  it('drapes sidewalks under both direction-dependent walking lanes', () => {
    const view = new RoadsView(10);
    const surface = new TerrainSurface({
      width: 10,
      height: 10,
      elevation: new Float32Array(100).fill(0.6),
      seaLevel: 0.35,
      water: new Uint8Array(100),
    });
    view.setTerrainSurface(surface);
    view.setWater(new Uint8Array(100));
    view.update([21, 31, 41]);

    const sidewalks = mesh(view, 'road-sidewalks');
    const positions = sidewalks.geometry.getAttribute('position').array as Float32Array;
    const indices = sidewalks.geometry.getIndex()?.array;
    const xs = Array.from({ length: positions.length / 3 }, (_, i) => positions[i * 3]);
    const ys = Array.from({ length: positions.length / 3 }, (_, i) => positions[i * 3 + 1]);

    expect(view.sidewalkPatchCount).toBe(8);
    expect(sidewalks.visible).toBe(true);
    expect(Math.min(...xs)).toBeCloseTo(1, 5);
    expect(Math.max(...xs)).toBeCloseTo(2, 5);
    expect(xs.some((x) => Math.abs(x - (1 + SIDEWALK_WIDTH)) < 1e-5)).toBe(true);
    expect(xs.some((x) => Math.abs(x - (2 - SIDEWALK_WIDTH)) < 1e-5)).toBe(true);
    const hasInnerEndTriangle = (z: number): boolean => {
      if (!indices) return false;
      for (let i = 0; i < indices.length; i += 3) {
        const vertices = [indices[i], indices[i + 1], indices[i + 2]];
        const triangleX = vertices.map((vertex) => positions[vertex * 3]);
        const triangleZ = vertices.map((vertex) => positions[vertex * 3 + 2]);
        if (
          triangleX.every(
            (value) => value >= 1 + SIDEWALK_WIDTH - 1e-5 &&
              value <= 2 - SIDEWALK_WIDTH + 1e-5,
          ) &&
          triangleZ.some((value) => Math.abs(value - z) < 1e-5)
        ) return true;
      }
      return false;
    };
    expect(hasInnerEndTriangle(2)).toBe(true);
    expect(hasInnerEndTriangle(5)).toBe(true);
    expect(ys.every((y) => Math.abs(y - (surface.maxHeight + SIDEWALK_Y)) < 1e-5)).toBe(true);
  });

  it('adds complementary traffic-light assemblies only to T and four-way junctions', () => {
    const tJunction = new RoadsView(10);
    tJunction.setWater(new Uint8Array(100));
    tJunction.update([30, 31, 32, 41]);
    expect(tJunction.sidewalkPatchCount).toBe(14);
    expect(tJunction.signalizedIntersectionCount).toBe(1);
    expect(tJunction.trafficSignalAssemblyCount).toBe(3);

    const crossing = new RoadsView(10);
    crossing.setWater(new Uint8Array(100));
    crossing.update([21, 30, 31, 32, 41]);
    const signals = mesh(crossing, 'road-traffic-signals');
    const colors = signals.geometry.getAttribute('color').array as Float32Array;
    const encoded = new Set(
      Array.from({ length: colors.length / 3 }, (_, i) =>
        new Color().setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]).getHex(),
      ),
    );

    expect(crossing.signalizedIntersectionCount).toBe(1);
    expect(crossing.sidewalkPatchCount).toBe(16);
    expect(crossing.trafficSignalAssemblyCount).toBe(4);
    expect(signals.visible).toBe(true);
    expect(encoded).toContain(TRAFFIC_SIGNAL_ACTIVE_RED);
    expect(encoded).toContain(TRAFFIC_SIGNAL_ACTIVE_GREEN);
    const laneFromEdge = 0.5 - PEDESTRIAN_CURB_OFFSET;
    const maxPedestrianHalfWidth = Math.max(
      (PEDESTRIAN_BODY.width * PEDESTRIAN_MAX_WIDTH_SCALE) / 2,
      PEDESTRIAN_HEAD.radius * PEDESTRIAN_MAX_WIDTH_SCALE,
    );
    expect(laneFromEdge - TRAFFIC_SIGNAL_CORNER_INSET).toBeGreaterThan(
      maxPedestrianHalfWidth + TRAFFIC_SIGNAL_POLE_HALF_WIDTH,
    );
    const maxPedestrianTopFromSidewalk =
      PEDESTRIAN_Y - SIDEWALK_Y +
      (PEDESTRIAN_HEAD.y + PEDESTRIAN_HEAD.radius) * PEDESTRIAN_MAX_HEIGHT_SCALE;
    expect(TRAFFIC_SIGNAL_HOUSING_BOTTOM).toBeGreaterThan(maxPedestrianTopFromSidewalk);

    const elevation = Float32Array.from({ length: 100 }, (_, index) => {
      const x = index % 10;
      const z = Math.floor(index / 10);
      return 0.36 + (x + z) * 0.018;
    });
    const slope = new TerrainSurface({
      width: 10,
      height: 10,
      elevation,
      seaLevel: 0.35,
      water: new Uint8Array(100),
    });
    const slopedCrossing = new RoadsView(10);
    slopedCrossing.setTerrainSurface(slope);
    slopedCrossing.setWater(new Uint8Array(100));
    slopedCrossing.update([21, 30, 31, 32, 41]);
    const slopedSignals = mesh(slopedCrossing, 'road-traffic-signals');
    const slopedPositions = slopedSignals.geometry.getAttribute('position').array as Float32Array;
    const slopedColors = slopedSignals.geometry.getAttribute('color').array as Float32Array;
    const housingYs = Array.from(
      { length: slopedColors.length / 3 },
      (_, i) => i,
    ).filter((i) => new Color().setRGB(
      slopedColors[i * 3],
      slopedColors[i * 3 + 1],
      slopedColors[i * 3 + 2],
    ).getHex() === TRAFFIC_SIGNAL_HOUSING_COLOR).map((i) => slopedPositions[i * 3 + 1]);
    const junctionTop = slope.footprintRange(1, 3, 1, 1).max;
    expect(junctionTop).toBeGreaterThan(
      slope.heightAt(1 + TRAFFIC_SIGNAL_CORNER_INSET, 3 + TRAFFIC_SIGNAL_CORNER_INSET),
    );
    expect(Math.min(...housingYs)).toBeCloseTo(
      junctionTop + SIDEWALK_Y + TRAFFIC_SIGNAL_HOUSING_BOTTOM,
      5,
    );
    expect(Math.min(...housingYs)).toBeGreaterThan(
      junctionTop + PEDESTRIAN_Y +
        (PEDESTRIAN_HEAD.y + PEDESTRIAN_HEAD.radius) * PEDESTRIAN_MAX_HEIGHT_SCALE,
    );

    const corner = new RoadsView(10);
    corner.setWater(new Uint8Array(100));
    corner.update([31, 32, 42]);
    expect(corner.signalizedIntersectionCount).toBe(0);
    expect(corner.trafficSignalAssemblyCount).toBe(0);
    expect(mesh(corner, 'road-traffic-signals').visible).toBe(false);
  });

  it('resets streetscape counters and hides both layers on an empty update', () => {
    const view = new RoadsView(10);
    view.setWater(new Uint8Array(100));
    view.update([21, 30, 31, 32, 41]);
    view.update([]);

    expect(view.sidewalkPatchCount).toBe(0);
    expect(view.signalizedIntersectionCount).toBe(0);
    expect(view.trafficSignalAssemblyCount).toBe(0);
    expect(mesh(view, 'road-sidewalks').visible).toBe(false);
    expect(mesh(view, 'road-traffic-signals').visible).toBe(false);
  });

  it('does not wrap lane direction across row edges', () => {
    const view = new RoadsView(10);
    view.setWater(new Uint8Array(100));
    view.update([9, 10]);

    const laneMesh = mesh(view, 'road-lane-markings');
    const positions = laneMesh.geometry.getAttribute('position').array as Float32Array;

    expect(laneMesh.geometry.getAttribute('position').count).toBe(16);
    const firstX = Array.from({ length: 8 }, (_, i) => positions[i * 3]);
    const firstZ = Array.from({ length: 8 }, (_, i) => positions[i * 3 + 2]);
    const secondX = Array.from({ length: 8 }, (_, i) => positions[(i + 8) * 3]);
    const secondZ = Array.from({ length: 8 }, (_, i) => positions[(i + 8) * 3 + 2]);
    expectClose(Math.min(...firstX), 9.5 - ROAD_LANE_MARKING_WIDTH / 2);
    expectClose(Math.min(...firstZ), 0.5 - ROAD_LANE_MARKING_LENGTH / 2);
    expectClose(Math.min(...secondX), 0.5 - ROAD_LANE_MARKING_WIDTH / 2);
    expectClose(Math.min(...secondZ), 1.5 - ROAD_LANE_MARKING_LENGTH / 2);
  });
});
