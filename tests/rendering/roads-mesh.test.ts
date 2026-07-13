import { describe, expect, it } from 'vitest';
import { Mesh, MeshLambertMaterial } from 'three';
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
} from '../../src/rendering/constants';
import { RoadsView } from '../../src/rendering/roads-mesh';
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
