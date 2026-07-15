import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { WATER_SURFACE_Y, WATER_WIND_DIRECTION } from '../../src/rendering/constants';
import { GeometryBuilder } from '../../src/rendering/geometry-builder';
import {
  UTILITY_PAD_LIFT,
  WIND_ROTOR_RADIUS,
  WIND_ROTOR_SPEED,
  WIND_TOWER_HEIGHT,
} from '../../src/rendering/utility-structure-style';
import {
  addCoalPlant,
  addWaterPump,
  addWindTurbine,
  buildWindRotor,
  WIND_FACING,
  windRotorAngle,
  windRotorHubPosition,
  type StructurePart,
} from '../../src/rendering/utility-structures';
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

describe('coal plant geometry', () => {
  it('builds a solid, multi-part industrial complex inside its footprint', () => {
    const builder = new GeometryBuilder();
    const parts = addCoalPlant(builder, flatSurface(), 4, 6, 3, 3);

    expectSolidParts(parts);
    expectNoDuplicateParts(parts);
    // Whole complex stays inside the 3x3 footprint.
    for (const part of parts) {
      expect(part.min[0]).toBeGreaterThanOrEqual(4 - 0.02);
      expect(part.max[0]).toBeLessThanOrEqual(7 + 0.02);
      expect(part.min[2]).toBeGreaterThanOrEqual(6 - 0.02);
      expect(part.max[2]).toBeLessThanOrEqual(9 + 0.02);
    }
    // Landmark smokestacks: at least two parts reaching industrial height.
    const stacks = parts.filter((p) => p.kind === 'stack');
    expect(stacks.length).toBeGreaterThanOrEqual(2);
    for (const stack of stacks) expect(stack.max[1]).toBeGreaterThanOrEqual(2);
    // Storytelling parts must exist.
    for (const kind of ['pad', 'hall', 'boiler', 'coal-pile', 'conveyor', 'condenser']) {
      expect(parts.some((p) => p.kind === kind), kind).toBe(true);
    }
    // Far richer than the old single gray block.
    expect(distinctColors(builder)).toBeGreaterThanOrEqual(6);
  });

  it('levels its pad across a sloped footprint', () => {
    const surface = slopedSurface();
    const builder = new GeometryBuilder();
    const parts = addCoalPlant(builder, surface, 1, 1, 3, 3);
    const range = surface.footprintRange(1, 1, 3, 3);

    const pad = parts.find((p) => p.kind === 'pad');
    expect(pad).toBeDefined();
    // Pad top is level above the highest corner; its base buries below the lowest.
    expect(pad!.max[1]).toBeCloseTo(range.max + UTILITY_PAD_LIFT, 5);
    expect(pad!.min[1]).toBeLessThanOrEqual(range.min);
    // Everything else stands on the leveled pad, never below it.
    for (const part of parts) {
      if (part.kind === 'pad') continue;
      expect(part.min[1], part.kind).toBeGreaterThanOrEqual(pad!.max[1] - 1e-4);
    }
  });

  it('is deterministic for identical inputs', () => {
    const a = new GeometryBuilder();
    const b = new GeometryBuilder();
    addCoalPlant(a, slopedSurface(), 2, 3, 3, 3);
    addCoalPlant(b, slopedSurface(), 2, 3, 3, 3);
    expect(a.build().getAttribute('position').array).toEqual(
      b.build().getAttribute('position').array,
    );
    expect(a.build().getAttribute('color').array).toEqual(b.build().getAttribute('color').array);
  });
});

describe('wind turbine geometry', () => {
  it('raises a slender tower with a wind-facing nacelle inside its cell', () => {
    const builder = new GeometryBuilder();
    const parts = addWindTurbine(builder, flatSurface(), 10, 12);

    expectSolidParts(parts);
    expectNoDuplicateParts(parts);
    for (const part of parts) {
      expect(part.min[0]).toBeGreaterThanOrEqual(10 - 0.05);
      expect(part.max[0]).toBeLessThanOrEqual(11 + 0.05);
      expect(part.min[2]).toBeGreaterThanOrEqual(12 - 0.05);
      expect(part.max[2]).toBeLessThanOrEqual(13 + 0.05);
    }
    const tower = parts.find((p) => p.kind === 'tower');
    expect(tower).toBeDefined();
    expect(tower!.max[1]).toBeGreaterThanOrEqual(WIND_TOWER_HEIGHT);
    // The tower is a mast, not a block: slender against the cell.
    expect(tower!.max[0] - tower!.min[0]).toBeLessThanOrEqual(0.3);
    expect(tower!.max[2] - tower!.min[2]).toBeLessThanOrEqual(0.3);
    expect(parts.some((p) => p.kind === 'nacelle')).toBe(true);
  });

  it('builds a three-blade rotor swept to the configured radius around the hub', () => {
    const builder = new GeometryBuilder();
    const parts = buildWindRotor(builder);

    expectSolidParts(parts);
    const blades = parts.filter((p) => p.kind === 'blade');
    expect(blades.length).toBe(3);
    expect(parts.some((p) => p.kind === 'spinner')).toBe(true);

    const positions = builder.build().getAttribute('position');
    let sweep = 0;
    for (let i = 0; i < positions.count; i++) {
      sweep = Math.max(sweep, Math.hypot(positions.getX(i), positions.getY(i)));
    }
    expect(sweep).toBeLessThanOrEqual(WIND_ROTOR_RADIUS + 0.02);
    expect(sweep).toBeGreaterThanOrEqual(WIND_ROTOR_RADIUS - 0.1);
  });

  it('faces the rotor upwind of the shared prevailing wind', () => {
    const wind = new Vector3(WATER_WIND_DIRECTION.x, 0, WATER_WIND_DIRECTION.z).normalize();
    const axis = new Vector3(0, 0, 1).applyQuaternion(WIND_FACING);
    expect(axis.dot(wind)).toBeLessThan(-0.999);
    expect(Math.abs(axis.y)).toBeLessThan(1e-6);
  });

  it('mounts the hub upwind of the tower top', () => {
    const surface = slopedSurface();
    const hub = windRotorHubPosition(surface, 10, 12);
    const ground = surface.footprintRange(10, 12, 1, 1).max;
    expect(hub.y).toBeGreaterThanOrEqual(ground + WIND_TOWER_HEIGHT - 0.2);
    const wind = new Vector3(WATER_WIND_DIRECTION.x, 0, WATER_WIND_DIRECTION.z).normalize();
    const offset = new Vector3(hub.x - 10.5, 0, hub.z - 12.5);
    const distance = offset.length();
    expect(distance).toBeGreaterThan(0.05);
    expect(distance).toBeLessThan(0.4);
    expect(offset.normalize().dot(wind)).toBeLessThan(-0.999);
  });

  it('spins linearly with presentation time and offsets phase per cell', () => {
    const cell = 700;
    const delta = windRotorAngle(2500, cell) - windRotorAngle(1000, cell);
    expect(delta).toBeCloseTo(WIND_ROTOR_SPEED * 1.5, 6);
    const phases = new Set(
      [700, 701, 830].map((c) => (windRotorAngle(0, c) % (Math.PI * 2)).toFixed(4)),
    );
    expect(phases.size).toBe(3);
  });
});

describe('water pump geometry', () => {
  const gridWidth = 64;
  const cell = 5 * gridWidth + 5; // cell (5, 5)

  it('reaches its intake into the adjacent water cell and dips to the water surface', () => {
    const builder = new GeometryBuilder();
    const east = cell + 1;
    const parts = addWaterPump(builder, flatSurface(), gridWidth, 64, cell, (c) => c === east);

    expectSolidParts(parts);
    expectNoDuplicateParts(parts);
    const intake = parts.find((p) => p.kind === 'intake');
    expect(intake).toBeDefined();
    // Reaches past the shared cell edge (x = 6) over the water.
    expect(intake!.max[0]).toBeGreaterThan(6.1);
    // And dips down close to the water surface plane.
    expect(intake!.min[1]).toBeLessThanOrEqual(WATER_SURFACE_Y + 0.08);
    // The rest of the station stays on its own cell.
    for (const part of parts) {
      if (part.kind === 'intake') continue;
      expect(part.max[0], part.kind).toBeLessThanOrEqual(6 + 0.02);
      expect(part.min[0], part.kind).toBeGreaterThanOrEqual(5 - 0.02);
    }
    expect(parts.some((p) => p.kind === 'house')).toBe(true);
    expect(parts.some((p) => p.kind === 'tank')).toBe(true);
  });

  it('follows the water to whichever side it borders', () => {
    const north = cell - gridWidth;
    const builder = new GeometryBuilder();
    const parts = addWaterPump(builder, flatSurface(), gridWidth, 64, cell, (c) => c === north);
    const intake = parts.find((p) => p.kind === 'intake');
    expect(intake).toBeDefined();
    // North is -z: the intake crosses the z = 5 edge.
    expect(intake!.min[2]).toBeLessThan(5 - 0.1);
    expect(intake!.max[0]).toBeLessThanOrEqual(6 + 0.02);
  });

  it('still builds a complete station when no neighbor is water', () => {
    const builder = new GeometryBuilder();
    const parts = addWaterPump(builder, flatSurface(), gridWidth, 64, cell, () => false);
    expectSolidParts(parts);
    expect(parts.some((p) => p.kind === 'intake')).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    const a = new GeometryBuilder();
    const b = new GeometryBuilder();
    addWaterPump(a, slopedSurface(), gridWidth, 64, cell, (c) => c === cell + 1);
    addWaterPump(b, slopedSurface(), gridWidth, 64, cell, (c) => c === cell + 1);
    expect(a.build().getAttribute('position').array).toEqual(
      b.build().getAttribute('position').array,
    );
  });
});

