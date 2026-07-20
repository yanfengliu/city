import { describe, expect, it } from 'vitest';
import { GeometryBuilder } from '../../src/rendering/geometry-builder';
import { addGarden, addPark } from '../../src/rendering/leisure-structures';
import {
  addClinic,
  addFireStation,
  addPoliceStation,
  addSchool,
} from '../../src/rendering/service-structures';
import { SERVICE_PAD_LIFT } from '../../src/rendering/structure-style';
import type { StructurePart } from '../../src/rendering/utility-structures';
import type { TerrainSurfaceView } from '../../src/rendering/terrain-surface';

const flatSurface = (width = 64, height = 64): TerrainSurfaceView => ({
  width,
  height,
  minHeight: 0,
  maxHeight: 0,
  cellHeight: () => 0,
  cornerHeight: () => 0,
  heightAt: () => 0,
  groundHeightAt: () => 0,
  footprintRange: () => ({ min: 0, max: 0 }),
});

const byKind = (parts: StructurePart[], kind: string): StructurePart[] =>
  parts.filter((part) => part.kind === kind);

const one = (parts: StructurePart[], kind: string): StructurePart => {
  const matches = byKind(parts, kind);
  expect(matches, kind).toHaveLength(1);
  return matches[0];
};

const vertexCount = (
  add: typeof addPark,
): number => {
  const builder = new GeometryBuilder();
  add(builder, flatSurface(), 4, 6, 2, 2);
  return builder.build().getAttribute('position').count;
};

/** Bounding-box volume of the fattest part a model emits above its pad. */
const largestPartVolume = (parts: StructurePart[]): number => {
  let largest = 0;
  for (const part of parts) {
    if (part.kind === 'pad') continue;
    largest = Math.max(
      largest,
      (part.max[0] - part.min[0]) * (part.max[1] - part.min[1]) * (part.max[2] - part.min[2]),
    );
  }
  return largest;
};

describe('park geometry', () => {
  const top = SERVICE_PAD_LIFT;

  /** Footprint-relative part boxes, so composition can be compared across anchors. */
  const relativeBoxes = (parts: StructurePart[], kind: string, x: number, y: number): string[] =>
    byKind(parts, kind).map((part) =>
      [
        part.min[0] - x, part.min[1], part.min[2] - y,
        part.max[0] - x, part.max[1], part.max[2] - y,
      ]
        .map((value) => value.toFixed(4))
        .join(','),
    );

  it('lays a mown lawn with pale cross paths meeting at a plaza', () => {
    const parts = addPark(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);

    const pad = one(parts, 'pad');
    expect(pad.max[1]).toBeCloseTo(top, 5);
    const paths = byKind(parts, 'path');
    expect(paths).toHaveLength(2);
    const spans = paths.map((path) => [path.max[0] - path.min[0], path.max[2] - path.min[2]]);
    expect(spans.some(([sx, sz]) => sx > 1.5 && sz < 0.5)).toBe(true);
    expect(spans.some(([sx, sz]) => sz > 1.5 && sx < 0.5)).toBe(true);
    for (const path of paths) expect(path.max[1] - path.min[1]).toBeLessThanOrEqual(0.03);
    const plaza = one(parts, 'plaza');
    expect(plaza.max[1] - plaza.min[1]).toBeLessThanOrEqual(0.03);
    expect((plaza.min[0] + plaza.max[0]) / 2).toBeCloseTo(5, 5);
    expect((plaza.min[2] + plaza.max[2]) / 2).toBeCloseTo(7, 5);
    expect(byKind(parts, 'mow-stripe').length).toBeGreaterThanOrEqual(3);
  });

  it('plants a deterministic grove whose species and heights vary between parks', () => {
    const here = addPark(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const trees = byKind(here, 'tree');
    expect(trees.length).toBeGreaterThanOrEqual(8);
    expect(new Set(trees.map((tree) => (tree.max[1] - top).toFixed(3))).size)
      .toBeGreaterThanOrEqual(4);
    expect(new Set(trees.map((tree) => (tree.max[0] - tree.min[0]).toFixed(3))).size)
      .toBeGreaterThanOrEqual(2);

    const again = addPark(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    expect(relativeBoxes(again, 'tree', 4, 6)).toEqual(relativeBoxes(here, 'tree', 4, 6));
    const elsewhere = addPark(new GeometryBuilder(), flatSurface(), 11, 3, 2, 2);
    expect(relativeBoxes(elsewhere, 'tree', 11, 3)).not.toEqual(relativeBoxes(here, 'tree', 4, 6));
  });

  it('furnishes the lawn with a fountain, pond, benches, lamps, and flower beds', () => {
    const parts = addPark(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const basin = one(parts, 'fountain-basin');
    expect(basin.max[1] - basin.min[1]).toBeLessThanOrEqual(0.25);
    const jet = one(parts, 'fountain-jet');
    expect(jet.min[1]).toBeGreaterThanOrEqual(basin.max[1] - 1e-4);
    expect(jet.max[0] - jet.min[0]).toBeLessThanOrEqual(0.2);
    const pond = one(parts, 'pond');
    expect(pond.max[1] - pond.min[1]).toBeLessThanOrEqual(0.12);
    expect(pond.max[0] - pond.min[0]).toBeGreaterThanOrEqual(0.35);
    expect(pond.min[0]).toBeGreaterThan(5);
    expect(pond.min[2]).toBeGreaterThan(7);
    const benches = byKind(parts, 'bench');
    expect(benches.length).toBeGreaterThanOrEqual(3);
    for (const bench of benches) {
      expect(bench.max[1] - bench.min[1]).toBeLessThanOrEqual(0.4);
      expect(Math.max(bench.max[0] - bench.min[0], bench.max[2] - bench.min[2]))
        .toBeGreaterThan(Math.min(bench.max[0] - bench.min[0], bench.max[2] - bench.min[2]));
    }
    const lamps = byKind(parts, 'lamp');
    expect(lamps.length).toBeGreaterThanOrEqual(2);
    for (const lamp of lamps) {
      expect(lamp.max[1] - top).toBeGreaterThanOrEqual(0.4);
      expect(lamp.max[0] - lamp.min[0]).toBeLessThanOrEqual(0.2);
    }
    expect(byKind(parts, 'flower-bed').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a tiered silhouette so an overlay flat-tint is still readable', () => {
    const parts = addPark(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const heights = parts.filter((part) => part.kind !== 'pad').map((part) => part.max[1] - top);
    expect(heights.filter((height) => height <= 0.08).length).toBeGreaterThanOrEqual(4);
    expect(heights.filter((height) => height > 0.08 && height < 0.5).length)
      .toBeGreaterThanOrEqual(4);
    const tall = heights.filter((height) => height >= 0.5);
    expect(tall.length).toBeGreaterThanOrEqual(6);
    expect(new Set(tall.map((height) => height.toFixed(2))).size).toBeGreaterThanOrEqual(3);
  });
});

describe('community garden geometry', () => {
  const top = SERVICE_PAD_LIFT;

  it('reads as a formal allotment with symmetrical raised beds and a gravel spine', () => {
    const parts = addGarden(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const beds = byKind(parts, 'raised-bed');
    expect(beds).toHaveLength(6);
    expect(byKind(parts, 'path')).toHaveLength(1);
    expect(beds.map((bed) => ((bed.min[0] + bed.max[0]) / 2 - 5).toFixed(3)))
      .toEqual(['-0.500', '0.500', '-0.500', '0.500', '-0.500', '0.500']);
    for (const bed of beds) {
      expect(bed.max[1] - top).toBeGreaterThan(0.05);
      expect(bed.max[1] - top).toBeLessThan(0.2);
    }
  });

  it('frames a south entrance with clipped hedges and a cream pergola', () => {
    const parts = addGarden(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    expect(byKind(parts, 'hedge')).toHaveLength(5);
    const pergola = one(parts, 'pergola');
    expect(pergola.max[1] - top).toBeGreaterThanOrEqual(0.65);
    expect(pergola.min[0]).toBeGreaterThan(4.7);
    expect(pergola.max[0]).toBeLessThan(5.3);
    expect(pergola.min[2]).toBeGreaterThan(7.5);
  });

  it('is deterministic, solid, contained, and cheaper than the park vertex budget', () => {
    const first = new GeometryBuilder();
    const second = new GeometryBuilder();
    const parts = addGarden(first, flatSurface(), 4, 6, 2, 2);
    addGarden(second, flatSurface(), 4, 6, 2, 2);
    expect(first.build().getAttribute('position').array)
      .toEqual(second.build().getAttribute('position').array);

    for (const part of parts) {
      for (const axis of [0, 1, 2] as const) {
        expect(part.max[axis], `${part.kind} axis ${axis}`).toBeGreaterThan(part.min[axis]);
      }
      expect(part.min[0], part.kind).toBeGreaterThanOrEqual(4 - 0.02);
      expect(part.max[0], part.kind).toBeLessThanOrEqual(6 + 0.02);
      expect(part.min[2], part.kind).toBeGreaterThanOrEqual(6 - 0.02);
      expect(part.max[2], part.kind).toBeLessThanOrEqual(8 + 0.02);
    }

    expect(vertexCount(addGarden)).toBeLessThan(900);
    expect(vertexCount(addGarden)).toBeLessThan(vertexCount(addPark));
  });

  it('cannot be mistaken for a park-only lawn, pond, fountain, or grove', () => {
    const gardenKinds = new Set(
      addGarden(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2).map((part) => part.kind),
    );
    for (const parkOnly of ['mow-stripe', 'plaza', 'fountain-basin', 'fountain-jet', 'pond', 'tree']) {
      expect(gardenKinds.has(parkOnly), parkOnly).toBe(false);
    }
  });
});

describe('leisure landscape silhouettes', () => {
  it('keeps parks and gardens visibly lighter than every civic building mass', () => {
    const surface = flatSurface();
    const build = (add: typeof addPark): StructurePart[] =>
      add(new GeometryBuilder(), surface, 4, 6, 2, 2);
    const park = largestPartVolume(build(addPark));
    const garden = largestPartVolume(build(addGarden));
    for (const [kind, add] of [
      ['fire station', addFireStation],
      ['police station', addPoliceStation],
      ['clinic', addClinic],
      ['school', addSchool],
    ] as const) {
      const civic = largestPartVolume(build(add));
      expect(park * 3, `park vs ${kind}`).toBeLessThan(civic);
      expect(garden * 3, `garden vs ${kind}`).toBeLessThan(civic);
    }
  });
});
