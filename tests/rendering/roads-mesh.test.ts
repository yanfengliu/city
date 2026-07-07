import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import {
  ROAD_DETAIL_END_INSET,
  ROAD_DETAIL_SIDE_INSET,
  ROAD_DETAIL_Y,
  TRAFFIC_OVERLAY_Y,
} from '../../src/rendering/constants';
import { RoadsView } from '../../src/rendering/roads-mesh';

const mesh = (view: RoadsView, name: string): Mesh => {
  const child = view.group.getObjectByName(name);
  expect(child).toBeInstanceOf(Mesh);
  return child as Mesh;
};

const expectClose = (actual: number, expected: number): void => {
  expect(actual).toBeCloseTo(expected, 5);
};

describe('RoadsView', () => {
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
    expect(detailMesh.geometry.getAttribute('position').count).toBe(8);

    const positions = detailMesh.geometry.getAttribute('position').array as Float32Array;
    expectClose(positions[0], ROAD_DETAIL_SIDE_INSET);
    expectClose(positions[1], ROAD_DETAIL_Y);
    expectClose(positions[2], 1 + ROAD_DETAIL_END_INSET);
    expectClose(positions[3], 1 - ROAD_DETAIL_SIDE_INSET);
    expectClose(positions[5], 1 + ROAD_DETAIL_END_INSET);
    expectClose(positions[6], ROAD_DETAIL_SIDE_INSET);
    expectClose(positions[8], 2 - ROAD_DETAIL_END_INSET);

    const colorAttribute = detailMesh.geometry.getAttribute('color');
    expect(colorAttribute).toBeDefined();
    const colors = colorAttribute.array as Float32Array;
    expect(colors.length).toBe(24);
    expect(colors[0]).not.toBe(colors[12]);

    view.update([11, 12]);

    expect(roadMesh.visible).toBe(false);
    expect(detailMesh.visible).toBe(false);
  });
});
