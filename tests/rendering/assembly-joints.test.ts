import { describe, expect, it } from 'vitest';

import { GeometryBuilder } from '../../src/rendering/geometry-builder';
import type { Color } from 'three';
import { addServiceStructure } from '../../src/rendering/service-structures';
import {
  addCoalPlant,
  addWaterPump,
  addWindTurbine,
  buildWindRotor,
  type StructurePart,
} from '../../src/rendering/utility-structures';
import type { ServiceKind } from '../../src/rendering/constants';
import type { TerrainSurfaceView } from '../../src/rendering/terrain-surface';

/**
 * Class audit for the defect registry's "detached part" family
 * (docs/learning/defect-register.md). Every model here is assembled from
 * separate primitives, and nothing checks that they still touch each other —
 * a lamp head, a roof, or a canopy can drift off its support and only a
 * screenshot from the right angle shows it. This asserts the one property
 * that has to hold for any assembly: its solids form a single connected body.
 *
 * It traces every PRIMITIVE the model emits, not the named parts it reports:
 * `ServiceModelFrame.part()` groups several primitives under one name and one
 * bounding box, so a part-level audit cannot see a lamp globe drift off the
 * post it shares a part with. Verified by floating that globe 0.05 — invisible
 * at part granularity, red at this one.
 *
 * The bound is deliberately coarse (axis-aligned bounds, touching counts as
 * joined) so it never fights a legitimate model. It catches the gross case;
 * the subtle case — solids whose bounds overlap while the surfaces still show
 * daylight — needs a shape-aware check like the canopy joint contract in
 * `trees.test.ts`.
 */

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

/** Float noise only. Solids that merely abut are joined; a real gap is not. */
const TOUCH_TOLERANCE = 1e-6;

/**
 * Records the bounds of every primitive the model emits. `GeometryBuilder`
 * already exposes `vertexCount`/`boundsSince` for exactly this; here they are
 * driven per primitive call rather than per named part.
 */
class TracingBuilder extends GeometryBuilder {
  readonly solids: StructurePart[] = [];
  private traced = 0;
  private depth = 0;

  /**
   * Vertices that went through a traced method. Compared against
   * `vertexCount` so a model emitting through a primitive this class does not
   * override is a loud failure rather than silent under-coverage — the audit
   * would otherwise pass by checking less than the model draws.
   */
  get tracedVertices(): number {
    return this.traced;
  }

  private trace(kind: string, emit: () => void): void {
    // Some primitives are built out of others (a beam lays quad corners), and
    // the inner call must not be counted twice or split into faces.
    if (this.depth > 0) {
      emit();
      return;
    }
    const start = this.vertexCount;
    this.depth++;
    try {
      emit();
    } finally {
      this.depth--;
    }
    const added = this.vertexCount - start;
    if (added === 0) return;
    this.traced += added;
    const bounds = this.boundsSince(start);
    this.solids.push({ kind, min: bounds.min, max: bounds.max });
  }

  override coloredBox(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    color: Color,
  ): void {
    this.trace('box', () => super.coloredBox(x0, y0, z0, x1, y1, z1, color));
  }

  override coloredTube(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    radiusFrom: number, radiusTo: number, segments: number, color: number,
  ): void {
    this.trace('tube', () => super.coloredTube(from, to, radiusFrom, radiusTo, segments, color));
  }

  override coloredBeam(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    up: readonly [number, number, number],
    halfFromX: number, halfFromY: number, halfToX: number, halfToY: number, color: number,
  ): void {
    this.trace('beam', () =>
      super.coloredBeam(from, to, up, halfFromX, halfFromY, halfToX, halfToY, color));
  }

  override coloredQuad(
    x0: number, z0: number, x1: number, z1: number, y: number, color: Color,
  ): void {
    this.trace('quad', () => super.coloredQuad(x0, z0, x1, z1, y, color));
  }

  override coloredQuadCorners(
    points: ReadonlyArray<readonly [number, number, number]>,
    color: Color,
  ): void {
    this.trace('quad', () => super.coloredQuadCorners(points, color));
  }
}

/**
 * Widest per-axis gap between two boxes. Zero or less on every axis means the
 * boxes overlap or touch, which is what "these two parts are joined" means
 * here; a positive value is the size of the daylight between them.
 */
const separation = (a: StructurePart, b: StructurePart): number => {
  let widest = -Infinity;
  for (let axis = 0; axis < 3; axis++) {
    widest = Math.max(widest, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]);
  }
  return widest;
};

interface Assembly {
  /** One entry per connected group of solids, largest (the body) first. */
  groups: number[][];
  /** Smallest gap that would have to close to join the strays to the body. */
  gap: number;
}

const analyze = (solids: StructurePart[]): Assembly => {
  const owner = solids.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (owner[root] !== root) root = owner[root];
    while (owner[index] !== root) [index, owner[index]] = [owner[index], root];
    return root;
  };
  for (let a = 0; a < solids.length; a++) {
    for (let b = a + 1; b < solids.length; b++) {
      if (separation(solids[a], solids[b]) <= TOUCH_TOLERANCE) owner[find(a)] = find(b);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let index = 0; index < solids.length; index++) {
    const root = find(index);
    byRoot.set(root, [...(byRoot.get(root) ?? []), index]);
  }
  const groups = [...byRoot.values()].sort((a, b) => b.length - a.length);
  let gap = Infinity;
  for (const stray of groups.slice(1)) {
    for (const index of stray) {
      for (const other of groups[0]) gap = Math.min(gap, separation(solids[index], solids[other]));
    }
  }
  return { groups, gap };
};

/**
 * Failure text has to be enough to find the solid without re-deriving the
 * analysis: which primitive (its draw order within the model), where it is,
 * and how far it would have to move to rejoin the body.
 */
const report = (name: string, solids: StructurePart[], assembly: Assembly): string => {
  const strays = assembly.groups.slice(1).flat();
  const where = (index: number): string => {
    const solid = solids[index];
    const centre = solid.min.map((low, axis) => ((low + solid.max[axis]) / 2).toFixed(3));
    return `${solid.kind} #${index} at (${centre.join(', ')})`;
  };
  return (
    `${name}: ${strays.length} of ${solids.length} solids are not joined to the body — ` +
    `${strays.map(where).join('; ')}. ` +
    `Nearest gap ${assembly.gap.toFixed(4)}; either close it or overlap the support.`
  );
};

// Keyed by ServiceKind so a new service kind fails to compile until it is
// listed here, rather than quietly skipping the audit.
const SERVICE_FOOTPRINTS: Record<ServiceKind, { w: number; h: number }> = {
  fireStation: { w: 2, h: 2 },
  police: { w: 2, h: 2 },
  clinic: { w: 2, h: 2 },
  school: { w: 2, h: 2 },
  park: { w: 2, h: 2 },
  garden: { w: 2, h: 2 },
};

const MODELS: { name: string; build: (builder: TracingBuilder) => void }[] = [
  ...(Object.keys(SERVICE_FOOTPRINTS) as ServiceKind[]).map((service) => ({
    name: `service:${service}`,
    build: (builder: TracingBuilder): void => {
      addServiceStructure(builder, flatSurface(), {
        x: 4,
        y: 6,
        ...SERVICE_FOOTPRINTS[service],
        service,
      });
    },
  })),
  {
    name: 'utility:coalPlant',
    build: (builder: TracingBuilder): void => {
      addCoalPlant(builder, flatSurface(), 4, 6, 3, 3);
    },
  },
  {
    name: 'utility:windTurbine',
    build: (builder: TracingBuilder): void => {
      addWindTurbine(builder, flatSurface(), 4, 6);
    },
  },
  {
    name: 'utility:windRotor',
    build: (builder: TracingBuilder): void => {
      buildWindRotor(builder);
    },
  },
  {
    name: 'utility:waterPump',
    build: (builder: TracingBuilder): void => {
      addWaterPump(builder, flatSurface(), 64, 64, 6 * 64 + 4, (cell) => cell % 64 > 5);
    },
  },
];

describe('structure assemblies', () => {
  it('covers every service kind and every utility model that emits parts', () => {
    expect(MODELS.map((model) => model.name)).toEqual([
      'service:fireStation',
      'service:police',
      'service:clinic',
      'service:school',
      'service:park',
      'service:garden',
      'utility:coalPlant',
      'utility:windTurbine',
      'utility:windRotor',
      'utility:waterPump',
    ]);
  });

  for (const model of MODELS) {
    it(`builds ${model.name} as one connected body, with no solid floating free`, () => {
      const builder = new TracingBuilder();
      model.build(builder);
      expect(builder.solids.length, `${model.name} emitted no geometry`).toBeGreaterThan(0);
      expect(
        builder.tracedVertices,
        `${model.name} emitted geometry through a builder method this audit does not trace`,
      ).toBe(builder.vertexCount);
      const assembly = analyze(builder.solids);
      expect(assembly.groups.length, report(model.name, builder.solids, assembly)).toBe(1);
    });
  }
});
