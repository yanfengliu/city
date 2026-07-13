import { describe, expect, it } from 'vitest';
import { Color, Mesh, MeshBasicMaterial } from 'three';
import type { Group } from 'three';
import {
  ZONE_GROUND_DETAIL_COLORS,
  ZONE_GROUND_DETAIL_INSET,
  ZONE_GROUND_DETAIL_OPACITY,
  ZONE_GROUND_DETAIL_Y,
} from '../../src/rendering/constants';
import { ZonesView } from '../../src/rendering/zones-mesh';
import { TerrainSurface } from '../../src/rendering/terrain-surface';

const expectClose = (actual: number, expected: number): void => {
  expect(actual).toBeCloseTo(expected, 5);
};

describe('ZonesView', () => {
  it('drapes planning parcels over the shared terrain surface', () => {
    const view = new ZonesView(10);
    const surface = new TerrainSurface({
      width: 10,
      height: 10,
      elevation: new Float32Array(100).fill(0.85),
      seaLevel: 0.35,
      water: new Uint8Array(100),
    });
    view.setTerrainSurface(surface);
    view.setZones([{ i: 12, zone: 'R' }]);
    view.flushIfDirty();

    const positions = view.mesh.geometry.getAttribute('position').array as Float32Array;
    expect(positions[1]).toBeGreaterThan(surface.maxHeight);
  });

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
    expect(detailedView.detailMesh?.geometry.getAttribute('position').count).toBe(12);

    const detailPositions = detailedView.detailMesh?.geometry.getAttribute('position')
      .array as Float32Array;
    const inset = ZONE_GROUND_DETAIL_INSET;
    const firstX = Array.from({ length: 6 }, (_, i) => detailPositions[i * 3]);
    const firstY = Array.from({ length: 6 }, (_, i) => detailPositions[i * 3 + 1]);
    const firstZ = Array.from({ length: 6 }, (_, i) => detailPositions[i * 3 + 2]);
    expectClose(Math.min(...firstX), 2 + inset);
    expectClose(Math.max(...firstX), 3 - inset);
    expect(firstY.every((value) => Math.abs(value - ZONE_GROUND_DETAIL_Y) < 1e-5)).toBe(true);
    expectClose(Math.min(...firstZ), 1 + inset);
    expectClose(Math.max(...firstZ), 2 - inset);

    const commercialColor = new Color(ZONE_GROUND_DETAIL_COLORS.C);
    const detailColors = detailedView.detailMesh?.geometry.getAttribute('color').array as Float32Array;
    expectClose(detailColors[18], commercialColor.r);
    expectClose(detailColors[19], commercialColor.g);
    expectClose(detailColors[20], commercialColor.b);

    view.setOccludedCells(new Set([13]));
    view.flushIfDirty();

    expect(view.mesh.geometry.getAttribute('position').count).toBe(4);
    expect(detailedView.detailMesh?.geometry.getAttribute('position').count).toBe(6);

    view.setOccludedCells(new Set([12, 13]));
    view.flushIfDirty();

    expect(view.mesh.visible).toBe(false);
    expect(detailedView.detailMesh?.visible).toBe(false);
  });

  it('renders empty zoning as light zone-colored planning parcels', () => {
    expect(ZONE_GROUND_DETAIL_INSET).toBeGreaterThanOrEqual(0.26);
    expect(ZONE_GROUND_DETAIL_OPACITY).toBeLessThanOrEqual(0.18);
    expect(new Color(ZONE_GROUND_DETAIL_COLORS.R).g).toBeGreaterThan(new Color(ZONE_GROUND_DETAIL_COLORS.R).r);
    expect(new Color(ZONE_GROUND_DETAIL_COLORS.C).b).toBeGreaterThan(new Color(ZONE_GROUND_DETAIL_COLORS.C).r);
    expect(new Color(ZONE_GROUND_DETAIL_COLORS.I).r).toBeGreaterThan(new Color(ZONE_GROUND_DETAIL_COLORS.I).b);

    const view = new ZonesView(10);
    const detailedView = view as ZonesView & { detailMesh?: Mesh };

    view.setZones([
      { i: 12, zone: 'R' },
      { i: 13, zone: 'C' },
      { i: 14, zone: 'I' },
    ]);
    view.setOccludedCells(new Set());
    view.flushIfDirty();

    expect(detailedView.detailMesh?.material).toBeInstanceOf(MeshBasicMaterial);
    expect((detailedView.detailMesh?.material as MeshBasicMaterial).opacity).toBe(ZONE_GROUND_DETAIL_OPACITY);

    const detailColors = detailedView.detailMesh?.geometry.getAttribute('color').array as Float32Array;
    const residential = new Color(ZONE_GROUND_DETAIL_COLORS.R);
    const commercial = new Color(ZONE_GROUND_DETAIL_COLORS.C);
    const industrial = new Color(ZONE_GROUND_DETAIL_COLORS.I);
    expectClose(detailColors[0], residential.r);
    expectClose(detailColors[1], residential.g);
    expectClose(detailColors[2], residential.b);
    expectClose(detailColors[18], commercial.r);
    expectClose(detailColors[19], commercial.g);
    expectClose(detailColors[20], commercial.b);
    expectClose(detailColors[36], industrial.r);
    expectClose(detailColors[37], industrial.g);
    expectClose(detailColors[38], industrial.b);
  });
});
