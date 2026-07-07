import { describe, expect, it } from 'vitest';
import { Color, Mesh } from 'three';
import type { Group } from 'three';
import {
  ZONE_GROUND_DETAIL_COLORS,
  ZONE_GROUND_DETAIL_INSET,
  ZONE_GROUND_DETAIL_Y,
} from '../../src/rendering/constants';
import { ZonesView } from '../../src/rendering/zones-mesh';

const expectClose = (actual: number, expected: number): void => {
  expect(actual).toBeCloseTo(expected, 5);
};

describe('ZonesView', () => {
  it('keeps inset ground-detail lots synchronized with visible zoned cells', () => {
    const view = new ZonesView(10);
    const detailedView = view as ZonesView & { group?: Group; detailMesh?: Mesh };

    view.setZones([
      { i: 12, zone: 'R' },
      { i: 13, zone: 'C' },
    ]);
    view.setOccludedCells(new Set());
    view.flushIfDirty();

    expect(detailedView.group?.getObjectByName('zone-ground-details')).toBeInstanceOf(Mesh);
    expect(detailedView.detailMesh).toBeInstanceOf(Mesh);
    expect(view.mesh.geometry.getAttribute('position').count).toBe(8);
    expect(detailedView.detailMesh?.geometry.getAttribute('position').count).toBe(8);

    const detailPositions = detailedView.detailMesh?.geometry.getAttribute('position')
      .array as Float32Array;
    const inset = ZONE_GROUND_DETAIL_INSET;
    expectClose(detailPositions[0], 2 + inset);
    expectClose(detailPositions[1], ZONE_GROUND_DETAIL_Y);
    expectClose(detailPositions[2], 1 + inset);
    expectClose(detailPositions[3], 3 - inset);
    expectClose(detailPositions[5], 1 + inset);
    expectClose(detailPositions[6], 2 + inset);
    expectClose(detailPositions[8], 2 - inset);

    const commercialColor = new Color(ZONE_GROUND_DETAIL_COLORS.C);
    const detailColors = detailedView.detailMesh?.geometry.getAttribute('color').array as Float32Array;
    expectClose(detailColors[12], commercialColor.r);
    expectClose(detailColors[13], commercialColor.g);
    expectClose(detailColors[14], commercialColor.b);

    view.setOccludedCells(new Set([13]));
    view.flushIfDirty();

    expect(view.mesh.geometry.getAttribute('position').count).toBe(4);
    expect(detailedView.detailMesh?.geometry.getAttribute('position').count).toBe(4);

    view.setOccludedCells(new Set([12, 13]));
    view.flushIfDirty();

    expect(view.mesh.visible).toBe(false);
    expect(detailedView.detailMesh?.visible).toBe(false);
  });
});
