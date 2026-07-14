import { describe, expect, it } from 'vitest';
import {
  BUILDING_FRONTAGE_PARTS,
  BUILDING_WINDOW_LAYOUTS,
  BUILDING_WINDOW_SURFACE_OFFSET,
  type ZoneKind,
} from '../../src/rendering/constants';
import {
  createBuildingFrontageGeometry,
  createBuildingWindowGeometry,
} from '../../src/rendering/building-archetype-geometry';

const zoneKinds: readonly ZoneKind[] = ['R', 'C', 'I'];

const expectedWindowPanels: Record<ZoneKind, number> = {
  R: 12,
  C: 24,
  I: 6,
};

const frontagePartSignatures = (zone: ZoneKind): string[] => {
  const geometry = createBuildingFrontageGeometry(zone);
  const position = geometry.getAttribute('position');
  const signatures: string[] = [];
  for (let part = 0; part < BUILDING_FRONTAGE_PARTS[zone].length; part++) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let vertex = part * 24; vertex < (part + 1) * 24; vertex++) {
      const values = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], values[axis]);
        max[axis] = Math.max(max[axis], values[axis]);
      }
    }
    for (let axis = 0; axis < 3; axis++) expect(max[axis] - min[axis]).toBeGreaterThan(0);
    signatures.push([...min, ...max].map((value) => value.toFixed(5)).join(':'));
  }
  geometry.dispose();
  return signatures;
};

describe('building archetype geometry', () => {
  it('puts literal windows on all four exterior faces with zone-specific density', () => {
    for (const zone of zoneKinds) {
      const geometry = createBuildingWindowGeometry(zone);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;

      expect(bounds).not.toBeNull();
      expect(geometry.getAttribute('position').count).toBe(expectedWindowPanels[zone] * 4);
      expect(bounds!.min.x).toBeCloseTo(-0.5 - BUILDING_WINDOW_SURFACE_OFFSET, 5);
      expect(bounds!.max.x).toBeCloseTo(0.5 + BUILDING_WINDOW_SURFACE_OFFSET, 5);
      expect(bounds!.min.z).toBeCloseTo(-0.5 - BUILDING_WINDOW_SURFACE_OFFSET, 5);
      expect(bounds!.max.z).toBeCloseTo(0.5 + BUILDING_WINDOW_SURFACE_OFFSET, 5);
      expect(bounds!.min.y).toBeGreaterThan(0);
      expect(bounds!.max.y).toBeLessThan(1);
      geometry.dispose();
    }

    expect(expectedWindowPanels.R).toBeGreaterThan(expectedWindowPanels.I);
    expect(expectedWindowPanels.C).toBeGreaterThan(expectedWindowPanels.R);
  });

  it('gives each zone semantic frontage features instead of a recolored shared slab', () => {
    expect(BUILDING_FRONTAGE_PARTS.R.map((part) => part.kind)).toEqual([
      'front-door',
      'stoop',
      'porch-canopy',
    ]);
    expect(BUILDING_FRONTAGE_PARTS.C.map((part) => part.kind)).toEqual([
      'double-entry',
      'awning',
      'sign-band',
      'blade-sign',
    ]);
    expect(BUILDING_FRONTAGE_PARTS.I.map((part) => part.kind)).toEqual([
      'loading-bay',
      'personnel-door',
      'loading-dock',
      'loading-hood',
      'bollard-left',
      'bollard-right',
    ]);

    for (const zone of zoneKinds) {
      const geometry = createBuildingFrontageGeometry(zone);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;

      expect(bounds).not.toBeNull();
      expect(bounds!.min.x).toBeGreaterThanOrEqual(-0.5);
      expect(bounds!.max.x).toBeLessThanOrEqual(0.5);
      expect(bounds!.min.y).toBeCloseTo(0, 5);
      expect(bounds!.max.y).toBeLessThan(1);
      expect(bounds!.min.z).toBeGreaterThan(0.5);
      expect(geometry.getAttribute('position').count).toBe(BUILDING_FRONTAGE_PARTS[zone].length * 24);
      geometry.dispose();
    }
  });

  it('builds byte-stable feature buffers from the presentation specs', () => {
    for (const zone of zoneKinds) {
      const firstWindows = createBuildingWindowGeometry(zone);
      const secondWindows = createBuildingWindowGeometry(zone);
      const firstFrontage = createBuildingFrontageGeometry(zone);
      const secondFrontage = createBuildingFrontageGeometry(zone);

      expect(Array.from(firstWindows.getAttribute('position').array)).toEqual(
        Array.from(secondWindows.getAttribute('position').array),
      );
      expect(Array.from(firstFrontage.getAttribute('position').array)).toEqual(
        Array.from(secondFrontage.getAttribute('position').array),
      );
      firstWindows.dispose();
      secondWindows.dispose();
      firstFrontage.dispose();
      secondFrontage.dispose();
    }
  });

  it('keeps every window layout inside normalized wall bounds', () => {
    for (const layout of Object.values(BUILDING_WINDOW_LAYOUTS)) {
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
      for (const x of layout.frontColumns) {
        expect(Math.abs(x) + layout.width / 2).toBeLessThan(0.5);
      }
      for (const z of layout.sideColumns) {
        expect(Math.abs(z) + layout.width / 2).toBeLessThan(0.5);
      }
      for (const y of layout.rows) {
        expect(y - layout.height / 2).toBeGreaterThan(0);
        expect(y + layout.height / 2).toBeLessThan(1);
      }
    }
  });

  it('keeps frontage parts volumetric and spatially distinct within each archetype', () => {
    for (const zone of zoneKinds) {
      const parts = BUILDING_FRONTAGE_PARTS[zone];
      const transforms = new Set<string>();
      for (const part of parts) {
        expect(part.size.every((dimension) => dimension > 0)).toBe(true);
        transforms.add(`${part.x}:${part.baseY}:${part.size.join(':')}`);
      }
      expect(transforms.size).toBe(parts.length);
      expect(new Set(frontagePartSignatures(zone)).size).toBe(parts.length);
    }
  });
});
