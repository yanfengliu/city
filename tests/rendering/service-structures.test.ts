import { describe, expect, it } from 'vitest';
import { GeometryBuilder } from '../../src/rendering/geometry-builder';
import {
  CLINIC_WALL_HEIGHT,
  FIRE_HALL_HEIGHT,
  FIRE_TOWER_HEIGHT,
  POLICE_WALL_HEIGHT,
  SCHOOL_FLAG_HEIGHT,
  SCHOOL_WALL_HEIGHT,
  SERVICE_PAD_LIFT,
} from '../../src/rendering/structure-style';
import {
  addClinic,
  addFireStation,
  addPoliceStation,
  addSchool,
  addServiceStructure,
} from '../../src/rendering/service-structures';
import type { ServiceKind } from '../../src/rendering/constants';
import type { StructurePart } from '../../src/rendering/utility-structures';
import type { TerrainSurfaceView } from '../../src/rendering/terrain-surface';

type AddModel = (
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
) => StructurePart[];

const MODELS: ReadonlyArray<[ServiceKind, AddModel]> = [
  ['fireStation', addFireStation],
  ['police', addPoliceStation],
  ['clinic', addClinic],
  ['school', addSchool],
];

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

const slopedSurface = (width = 64, height = 64): TerrainSurfaceView => {
  const heightAt = (x: number, z: number): number => x * 0.1 + z * 0.2;
  return {
    width,
    height,
    minHeight: 0,
    maxHeight: heightAt(width, height),
    cellHeight: heightAt,
    cornerHeight: heightAt,
    heightAt,
    groundHeightAt: heightAt,
    footprintRange: (x, z, w, h) => ({ min: heightAt(x, z), max: heightAt(x + w, z + h) }),
  };
};

/** Every part must be a real volume: strictly positive extent on all axes. */
const expectSolidParts = (parts: StructurePart[]): void => {
  expect(parts.length).toBeGreaterThan(0);
  for (const part of parts) {
    for (const axis of [0, 1, 2] as const) {
      expect(part.max[axis], `${part.kind} axis ${axis}`).toBeGreaterThan(part.min[axis]);
      expect(Number.isFinite(part.min[axis])).toBe(true);
      expect(Number.isFinite(part.max[axis])).toBe(true);
    }
  }
};

/** No two parts of one model may occupy the exact same box. */
const expectNoDuplicateParts = (parts: StructurePart[]): void => {
  const keys = parts.map((p) => JSON.stringify([p.min, p.max]));
  expect(new Set(keys).size).toBe(keys.length);
};

const expectContained = (
  parts: StructurePart[],
  x: number,
  y: number,
  w: number,
  h: number,
): void => {
  for (const part of parts) {
    expect(part.min[0], part.kind).toBeGreaterThanOrEqual(x - 0.02);
    expect(part.max[0], part.kind).toBeLessThanOrEqual(x + w + 0.02);
    expect(part.min[2], part.kind).toBeGreaterThanOrEqual(y - 0.02);
    expect(part.max[2], part.kind).toBeLessThanOrEqual(y + h + 0.02);
  }
};

const byKind = (parts: StructurePart[], kind: string): StructurePart[] =>
  parts.filter((p) => p.kind === kind);

const one = (parts: StructurePart[], kind: string): StructurePart => {
  const matches = byKind(parts, kind);
  expect(matches, kind).toHaveLength(1);
  return matches[0];
};

const distinctColors = (builder: GeometryBuilder): number => {
  const colors = builder.build().getAttribute('color');
  const seen = new Set<string>();
  for (let i = 0; i < colors.count; i++) {
    seen.add(
      [colors.getX(i).toFixed(3), colors.getY(i).toFixed(3), colors.getZ(i).toFixed(3)].join(','),
    );
  }
  return seen.size;
};

describe('service structure shared contracts', () => {
  it.each(MODELS)('%s builds solid, distinct parts inside its footprint', (_kind, add) => {
    const builder = new GeometryBuilder();
    const parts = add(builder, flatSurface(), 4, 6, 2, 2);

    expectSolidParts(parts);
    expectNoDuplicateParts(parts);
    expectContained(parts, 4, 6, 2, 2);
    // Far richer than the old three stacked boxes.
    expect(parts.length).toBeGreaterThanOrEqual(12);
    expect(distinctColors(builder)).toBeGreaterThanOrEqual(6);
  });

  it.each(MODELS)('%s levels its pad across a sloped footprint', (_kind, add) => {
    const surface = slopedSurface();
    const builder = new GeometryBuilder();
    const parts = add(builder, surface, 3, 5, 2, 2);
    const range = surface.footprintRange(3, 5, 2, 2);

    const pad = one(parts, 'pad');
    expect(pad.max[1]).toBeCloseTo(range.max + SERVICE_PAD_LIFT, 5);
    expect(pad.min[1]).toBeLessThanOrEqual(range.min);
    for (const part of parts) {
      if (part.kind === 'pad') continue;
      expect(part.min[1], part.kind).toBeGreaterThanOrEqual(pad.max[1] - 1e-4);
    }
  });

  it.each(MODELS)('%s is byte-identical for identical inputs', (_kind, add) => {
    const a = new GeometryBuilder();
    const b = new GeometryBuilder();
    add(a, slopedSurface(), 2, 3, 2, 2);
    add(b, slopedSurface(), 2, 3, 2, 2);
    expect(a.build().getAttribute('position').array).toEqual(
      b.build().getAttribute('position').array,
    );
    expect(a.build().getAttribute('color').array).toEqual(b.build().getAttribute('color').array);
  });

  it('gives each service a signature part the other services never use', () => {
    const signatures: Record<ServiceKind, string> = {
      fireStation: 'bay-door',
      police: 'sign',
      clinic: 'cross-v',
      school: 'flag',
    };
    const kindSets = new Map<ServiceKind, Set<string>>(
      MODELS.map(([kind, add]) => {
        const parts = add(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
        return [kind, new Set(parts.map((p) => p.kind))];
      }),
    );
    for (const [service, signature] of Object.entries(signatures) as [ServiceKind, string][]) {
      expect(kindSets.get(service)!.has(signature), `${service} has ${signature}`).toBe(true);
      for (const [other, kinds] of kindSets) {
        if (other === service) continue;
        expect(kinds.has(signature), `${other} must not have ${signature}`).toBe(false);
      }
    }
  });

  it('dispatches every service kind through addServiceStructure', () => {
    for (const [service, add] of MODELS) {
      const direct = new GeometryBuilder();
      const dispatched = new GeometryBuilder();
      add(direct, flatSurface(), 4, 6, 2, 2);
      addServiceStructure(dispatched, flatSurface(), { x: 4, y: 6, w: 2, h: 2, service });
      expect(dispatched.build().getAttribute('position').array).toEqual(
        direct.build().getAttribute('position').array,
      );
    }
  });
});

describe('fire station geometry', () => {
  const top = SERVICE_PAD_LIFT;

  it('reads as a drive-through hall with two red bays facing the road side', () => {
    const builder = new GeometryBuilder();
    const parts = addFireStation(builder, flatSurface(), 4, 6, 2, 2);

    const hall = one(parts, 'hall');
    // Wide low garage hall, not a tower block.
    expect(hall.max[0] - hall.min[0]).toBeGreaterThan(FIRE_HALL_HEIGHT);
    expect(hall.max[1]).toBeCloseTo(top + FIRE_HALL_HEIGHT, 5);

    const doors = byKind(parts, 'bay-door');
    expect(doors).toHaveLength(2);
    for (const door of doors) {
      // Bays open on the south (+z) face, toward the default camera/road side.
      expect(door.max[2]).toBeGreaterThanOrEqual(6 + 2 * 0.55);
      expect(door.max[2]).toBeGreaterThan(hall.max[2] - 1e-4);
      expect(door.max[1]).toBeLessThanOrEqual(top + FIRE_HALL_HEIGHT);
    }
    // Roll-up slat detailing on the doors.
    expect(byKind(parts, 'door-slat').length).toBeGreaterThanOrEqual(2);

    const apron = one(parts, 'apron');
    expect(apron.max[1] - apron.min[1]).toBeLessThanOrEqual(0.03);
    expect(apron.min[2]).toBeGreaterThanOrEqual(hall.max[2] - 1e-4);
  });

  it('raises a slender hose tower with a light above the hall', () => {
    const parts = addFireStation(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const tower = one(parts, 'tower');
    expect(tower.max[1]).toBeGreaterThanOrEqual(top + FIRE_TOWER_HEIGHT - 1e-4);
    expect(tower.max[0] - tower.min[0]).toBeLessThanOrEqual(0.5);
    expect(tower.max[2] - tower.min[2]).toBeLessThanOrEqual(0.5);
    const light = one(parts, 'tower-light');
    expect(light.min[1]).toBeGreaterThanOrEqual(top + FIRE_TOWER_HEIGHT);
    expect(byKind(parts, 'tower-cap')).toHaveLength(1);
    expect(byKind(parts, 'tower-band')).toHaveLength(1);
  });
});

describe('police station geometry', () => {
  const top = SERVICE_PAD_LIFT;

  it('stacks a two-tone station under a hip roof', () => {
    const parts = addPoliceStation(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const base = one(parts, 'base');
    const upper = one(parts, 'upper');
    expect(upper.min[1]).toBeGreaterThanOrEqual(base.max[1] - 1e-4);
    expect(upper.max[1]).toBeCloseTo(top + POLICE_WALL_HEIGHT, 5);
    const roof = one(parts, 'roof');
    expect(roof.max[1]).toBeGreaterThanOrEqual(top + POLICE_WALL_HEIGHT + 0.15);
  });

  it('marks the entrance with steps, a post canopy, and a blue sign and beacon', () => {
    const parts = addPoliceStation(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    expect(byKind(parts, 'step')).toHaveLength(2);
    const canopy = one(parts, 'canopy');
    expect(canopy.min[1]).toBeGreaterThanOrEqual(top + 0.4);
    expect(byKind(parts, 'canopy-post')).toHaveLength(2);
    const upper = one(parts, 'upper');
    const sign = one(parts, 'sign');
    expect(sign.max[2]).toBeGreaterThan(upper.max[2]);
    const lamp = one(parts, 'lamp');
    expect(lamp.min[1]).toBeGreaterThanOrEqual(top + 0.4);
    expect(byKind(parts, 'lamp-post')).toHaveLength(1);
  });

  it('fences a flat parking pad beside the station', () => {
    const parts = addPoliceStation(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const parking = one(parts, 'parking');
    expect(parking.max[1] - parking.min[1]).toBeLessThanOrEqual(0.03);
    const upper = one(parts, 'upper');
    expect(parking.min[0]).toBeGreaterThanOrEqual(upper.max[0] - 1e-4);
    const fences = byKind(parts, 'fence');
    expect(fences).toHaveLength(3);
    for (const fence of fences) {
      expect(fence.max[1]).toBeGreaterThanOrEqual(parking.max[1] + 0.05);
    }
  });
});

describe('clinic geometry', () => {
  const top = SERVICE_PAD_LIFT;

  it('is a white block with a parapet, glazing, and a glass entrance canopy', () => {
    const parts = addClinic(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const body = one(parts, 'body');
    expect(body.max[1]).toBeCloseTo(top + CLINIC_WALL_HEIGHT, 5);
    const parapet = one(parts, 'parapet');
    expect(parapet.min[0]).toBeLessThan(body.min[0]);
    expect(parapet.max[0]).toBeGreaterThan(body.max[0]);
    expect(parapet.min[1]).toBeGreaterThanOrEqual(body.max[1] - 1e-4);
    const glazing = one(parts, 'glazing');
    expect(glazing.max[0] - glazing.min[0]).toBeGreaterThanOrEqual(0.8);
    expect(byKind(parts, 'canopy')).toHaveLength(1);
    expect(byKind(parts, 'canopy-post')).toHaveLength(2);
  });

  it('mounts red crosses on the facade and the roof', () => {
    const parts = addClinic(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const body = one(parts, 'body');
    const vertical = one(parts, 'cross-v');
    const horizontal = one(parts, 'cross-h');
    // Upright bar is taller than wide; crossbar is wider than tall; both proud of the wall.
    expect(vertical.max[1] - vertical.min[1]).toBeGreaterThan(vertical.max[0] - vertical.min[0]);
    expect(horizontal.max[0] - horizontal.min[0]).toBeGreaterThan(
      horizontal.max[1] - horizontal.min[1],
    );
    expect(vertical.max[2]).toBeGreaterThan(body.max[2]);
    expect(horizontal.max[2]).toBeGreaterThan(body.max[2]);
    // The bars overlap into a cross.
    expect(horizontal.min[1]).toBeLessThan(vertical.max[1]);
    expect(horizontal.max[1]).toBeGreaterThan(vertical.min[1]);
    // Rooftop cross for the strategy camera.
    expect(one(parts, 'roof-cross-v').min[1]).toBeGreaterThanOrEqual(top + CLINIC_WALL_HEIGHT);
    expect(one(parts, 'roof-cross-h').min[1]).toBeGreaterThanOrEqual(top + CLINIC_WALL_HEIGHT);
  });

  it('marks an ambulance pad beside the building', () => {
    const parts = addClinic(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const body = one(parts, 'body');
    const pad = one(parts, 'ambulance-pad');
    expect(pad.max[1] - pad.min[1]).toBeLessThanOrEqual(0.03);
    expect(pad.min[0]).toBeGreaterThanOrEqual(body.max[0] - 1e-4);
    expect(byKind(parts, 'pad-cross-v')).toHaveLength(1);
    expect(byKind(parts, 'pad-cross-h')).toHaveLength(1);
  });
});

describe('school geometry', () => {
  const top = SERVICE_PAD_LIFT;

  it('joins two gabled wings into an L with big windows', () => {
    const parts = addSchool(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const wingA = one(parts, 'wing-a');
    const wingB = one(parts, 'wing-b');
    // Wing A runs east-west across the back; wing B runs north-south past it.
    expect(wingA.max[0] - wingA.min[0]).toBeGreaterThan(1.4);
    expect(wingA.max[2] - wingA.min[2]).toBeLessThanOrEqual(0.7);
    expect(wingB.max[2] - wingB.min[2]).toBeGreaterThanOrEqual(0.8);
    expect(wingB.max[0] - wingB.min[0]).toBeLessThanOrEqual(0.7);
    expect(wingB.max[2]).toBeGreaterThan(wingA.max[2]);
    for (const wing of [wingA, wingB]) {
      expect(wing.max[1]).toBeCloseTo(top + SCHOOL_WALL_HEIGHT, 5);
    }
    for (const roofKind of ['roof-a', 'roof-b']) {
      expect(one(parts, roofKind).max[1]).toBeGreaterThanOrEqual(top + SCHOOL_WALL_HEIGHT + 0.15);
    }
    const windows = byKind(parts, 'window');
    expect(windows.length).toBeGreaterThanOrEqual(4);
    for (const window of windows) {
      expect(window.min[1]).toBeGreaterThan(top + 0.1);
      // Thin panels proud of a wall, not blocks.
      const thickness = Math.min(window.max[0] - window.min[0], window.max[2] - window.min[2]);
      expect(thickness).toBeLessThanOrEqual(0.06);
    }
  });

  it('flies a flag and hangs a clock on the gable end', () => {
    const parts = addSchool(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const pole = one(parts, 'flag-pole');
    expect(pole.max[1]).toBeGreaterThanOrEqual(top + SCHOOL_FLAG_HEIGHT - 1e-4);
    expect(pole.max[0] - pole.min[0]).toBeLessThanOrEqual(0.1);
    const flag = one(parts, 'flag');
    expect(flag.min[1]).toBeGreaterThanOrEqual(top + SCHOOL_FLAG_HEIGHT - 0.25);
    const clock = one(parts, 'clock-face');
    expect(clock.min[1]).toBeGreaterThanOrEqual(top + 0.4);
  });

  it('fences a contrasting play-yard in the L', () => {
    const parts = addSchool(new GeometryBuilder(), flatSurface(), 4, 6, 2, 2);
    const wingA = one(parts, 'wing-a');
    const yard = one(parts, 'yard');
    expect(yard.max[1] - yard.min[1]).toBeLessThanOrEqual(0.03);
    expect(yard.min[2]).toBeGreaterThanOrEqual(wingA.max[2] - 1e-4);
    expect(byKind(parts, 'fence')).toHaveLength(3);
  });
});
