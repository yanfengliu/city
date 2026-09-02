import { describe, expect, it } from 'vitest';
import { Color, InstancedMesh, Matrix4, Vector2, Vector3 } from 'three';
import type { Box3, BufferGeometry } from 'three';

import {
  TREE_ARCHETYPES,
  TREE_FOLIAGE_PALETTES,
  TREE_POSITION_JITTER,
  TREE_SCALE_MIN,
  TREE_SCALE_RANGE,
  TREE_WIDTH_SCALE_MIN,
  TREE_WIDTH_SCALE_RANGE,
  type TreeArchetypeName,
} from '../../src/rendering/constants';
import { TreesView } from '../../src/rendering/trees';
import { TerrainSurface } from '../../src/rendering/terrain-surface';

const ARCHETYPE_NAMES: TreeArchetypeName[] = ['conifer', 'broadleaf', 'columnar'];
const LAYERS = ['trunks', 'lower-canopies', 'upper-canopies'] as const;

const makeTrees = (count = 256): TreesView =>
  new TreesView({ width: 16, trees: new Uint8Array(count).fill(1) });

const mesh = (view: TreesView, archetype: TreeArchetypeName, layer: (typeof LAYERS)[number]): InstancedMesh => {
  const result = view.group.getObjectByName(`trees-${archetype}-${layer}`);
  if (!(result instanceof InstancedMesh)) throw new Error(`missing ${archetype} ${layer}`);
  return result;
};

const bounds = (target: InstancedMesh): Box3 => {
  target.geometry.computeBoundingBox();
  const box = target.geometry.boundingBox;
  if (!box) throw new Error('missing geometry bounds');
  return box;
};

const dimensions = (target: InstancedMesh): Vector3 => bounds(target).getSize(new Vector3());

/**
 * Narrowest radius of the horizontal slice the plane `y` cuts out of the mesh:
 * every triangle edge straddling the plane is interpolated into a section
 * polygon, and the result is that polygon's distance to the axis at its
 * tightest side. Zero when the plane misses the geometry, or grazes a tapered
 * tip that leaves daylight from some angles — both of which read as a canopy
 * detached from its trunk. Valid for the convex, axis-centred canopy solids.
 */
const narrowestCrossSection = (geometry: BufferGeometry, y: number): number => {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const vertexCount = index ? index.count : position.count;
  const corner = (slot: number): Vector3 => {
    const vertex = index ? index.getX(slot) : slot;
    return new Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
  };
  const outline: Vector2[] = [];
  for (let slot = 0; slot < vertexCount; slot += 3) {
    const triangle = [corner(slot), corner(slot + 1), corner(slot + 2)];
    for (let edge = 0; edge < 3; edge++) {
      const from = triangle[edge];
      const to = triangle[(edge + 1) % 3];
      if ((from.y - y) * (to.y - y) > 0 || from.y === to.y) continue;
      const t = (y - from.y) / (to.y - from.y);
      outline.push(new Vector2(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t));
    }
  }
  if (outline.length < 3) return 0;
  outline.sort((a, b) => a.angle() - b.angle());
  let narrowest = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const from = outline[i];
    const span = new Vector2().subVectors(outline[(i + 1) % outline.length], from);
    const lengthSquared = span.lengthSq();
    if (lengthSquared < 1e-12) continue;
    const t = Math.max(0, Math.min(1, -from.dot(span) / lengthSquared));
    narrowest = Math.min(narrowest, from.clone().addScaledVector(span, t).length());
  }
  return Number.isFinite(narrowest) ? narrowest : 0;
};

const luminance = (hex: number): number => {
  const color = new Color(hex);
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
};

const colorDistance = (a: number, b: number): number => {
  const first = new Color(a);
  const second = new Color(b);
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b);
};

const totalCount = (view: TreesView, layer: (typeof LAYERS)[number]): number =>
  ARCHETYPE_NAMES.reduce((total, name) => total + mesh(view, name, layer).count, 0);

const snapshot = (view: TreesView): unknown[] => {
  const matrix = new Matrix4();
  const color = new Color();
  return ARCHETYPE_NAMES.flatMap((name) =>
    LAYERS.map((layer) => {
      const target = mesh(view, name, layer);
      return {
        name: target.name,
        count: target.count,
        matrices: Array.from({ length: target.count }, (_, slot) => {
          target.getMatrixAt(slot, matrix);
          return matrix.toArray();
        }),
        colors: Array.from({ length: target.count }, (_, slot) => {
          target.getColorAt(slot, color);
          return color.toArray();
        }),
      };
    }),
  );
};

/**
 * When checking that two solids visibly join, measure the joint where it is
 * NARROWEST across the full turn, not where it is widest. A convex solid that
 * tapers to an edge or a point is wide from exactly one azimuth, and a
 * max-radius probe finds precisely that one: the first version of this check
 * read 0.158 against a 0.075 trunk and passed, while the same slice measured
 * 0.040 perpendicular to the faceted bottom edge — daylight, on trees that are
 * randomly rotated per cell under a free-orbiting camera.
 *
 * The cheap half of the fix that paid the most: seat a mesh by its COMPUTED
 * bounding box rather than by its nominal dimensions, so a new shape cannot
 * silently be seated wrong.
 */
describe('TreesView diversity', () => {
  it('anchors every tree archetype to the shared terrain surface', () => {
    const surface = new TerrainSurface({
      width: 16,
      height: 16,
      elevation: new Float32Array(256).fill(0.85),
      seaLevel: 0.35,
      water: new Uint8Array(256),
    });
    const view = new TreesView({ width: 16, trees: new Uint8Array(256).fill(1) }, surface);
    const matrix = new Matrix4();
    for (const name of ARCHETYPE_NAMES) {
      const trunks = mesh(view, name, 'trunks');
      trunks.getMatrixAt(0, matrix);
      expect(matrix.elements[13]).toBeCloseTo(surface.maxHeight, 5);
    }
  });

  it('partitions trees across three visibly different low-poly silhouettes', () => {
    const view = makeTrees();

    expect(TREE_ARCHETYPES.map((archetype) => archetype.name)).toEqual(ARCHETYPE_NAMES);
    for (const name of ARCHETYPE_NAMES) {
      expect(mesh(view, name, 'trunks').count).toBeGreaterThan(0);
      expect(mesh(view, name, 'lower-canopies').count).toBeGreaterThan(0);
      expect(mesh(view, name, 'upper-canopies').count).toBeGreaterThan(0);
    }
    for (const layer of LAYERS) expect(totalCount(view, layer)).toBe(256);

    const conifer = mesh(view, 'conifer', 'lower-canopies');
    const broadleaf = mesh(view, 'broadleaf', 'lower-canopies');
    const columnar = mesh(view, 'columnar', 'lower-canopies');
    const coniferSize = dimensions(conifer);
    const broadleafSize = dimensions(broadleaf);
    const columnarSize = dimensions(columnar);

    expect(conifer.geometry.type).toBe('ConeGeometry');
    expect(broadleaf.geometry.type).toBe('DodecahedronGeometry');
    expect(columnar.geometry.type).toBe('DodecahedronGeometry');
    expect(broadleafSize.x / broadleafSize.y).toBeGreaterThan(1);
    expect(columnarSize.y / columnarSize.x).toBeGreaterThan(1.8);
    expect(coniferSize.x / coniferSize.y).toBeGreaterThan(columnarSize.x / columnarSize.y);

    const maximumUniformScale = TREE_SCALE_MIN + TREE_SCALE_RANGE;
    const maximumWidthScale = TREE_WIDTH_SCALE_MIN + TREE_WIDTH_SCALE_RANGE;
    for (const archetype of TREE_ARCHETYPES) {
      const maximumRadius = Math.max(archetype.lower.radius, archetype.upper.radius);
      const maximumReach =
        maximumRadius * maximumUniformScale * maximumWidthScale + TREE_POSITION_JITTER;
      expect(maximumReach).toBeLessThanOrEqual(0.5);
    }
  });

  it('seats every canopy on the trunk it grows from, with no daylight at the joint', () => {
    const view = makeTrees();

    for (const archetype of TREE_ARCHETYPES) {
      const trunkTop = bounds(mesh(view, archetype.name, 'trunks')).max.y;
      const lower = mesh(view, archetype.name, 'lower-canopies');
      const upper = mesh(view, archetype.name, 'upper-canopies');

      // The foliage settles onto the trunk rather than hovering above its tip.
      expect(bounds(lower).min.y).toBeLessThan(trunkTop);
      // And it is broader than the trunk where the two meet — measured at the
      // canopy's tightest side, so the joint closes from every angle rather
      // than only from the one the faceted bottom edge happens to face.
      expect(narrowestCrossSection(lower.geometry, trunkTop)).toBeGreaterThan(archetype.trunkRadius);

      // The upper tier is seated on the lower one by the same rule.
      const lowerTop = bounds(lower).max.y;
      expect(bounds(upper).min.y).toBeLessThan(lowerTop);
      expect(narrowestCrossSection(lower.geometry, bounds(upper).min.y)).toBeGreaterThan(0);
    }
  });

  it('offers coordinated foliage families with meaningful color separation', () => {
    expect(TREE_FOLIAGE_PALETTES).toHaveLength(4);
    for (const palette of TREE_FOLIAGE_PALETTES) {
      expect(luminance(palette.upper)).toBeGreaterThan(luminance(palette.lower));
      expect(luminance(palette.lower)).toBeGreaterThanOrEqual(0.16);
    }
    for (let i = 0; i < TREE_FOLIAGE_PALETTES.length; i++) {
      for (let j = i + 1; j < TREE_FOLIAGE_PALETTES.length; j++) {
        expect(
          colorDistance(TREE_FOLIAGE_PALETTES[i].lower, TREE_FOLIAGE_PALETTES[j].lower),
        ).toBeGreaterThanOrEqual(0.09);
      }
    }

    const view = makeTrees();
    const renderedLower: number[] = [];
    const renderedTrunks: number[] = [];
    const color = new Color();
    for (const name of ARCHETYPE_NAMES) {
      const lower = mesh(view, name, 'lower-canopies');
      const trunks = mesh(view, name, 'trunks');
      for (let slot = 0; slot < lower.count; slot++) {
        lower.getColorAt(slot, color);
        renderedLower.push(color.getHex());
        trunks.getColorAt(slot, color);
        renderedTrunks.push(color.getHex());
      }
    }
    for (const palette of TREE_FOLIAGE_PALETTES) {
      expect(renderedLower.some((actual) => colorDistance(actual, palette.lower) < 0.05)).toBe(true);
    }
    expect(new Set(renderedTrunks).size).toBeGreaterThanOrEqual(TREE_FOLIAGE_PALETTES.length);
  });

  it('keeps archetype, shape, and color assignment deterministic', () => {
    const first = makeTrees();
    const second = makeTrees();
    const firstMatrix = new Matrix4();
    const secondMatrix = new Matrix4();
    const firstColor = new Color();
    const secondColor = new Color();

    for (const name of ARCHETYPE_NAMES) {
      for (const layer of LAYERS) {
        const firstMesh = mesh(first, name, layer);
        const secondMesh = mesh(second, name, layer);
        expect(firstMesh.count).toBe(secondMesh.count);
        for (let slot = 0; slot < Math.min(5, firstMesh.count); slot++) {
          firstMesh.getMatrixAt(slot, firstMatrix);
          secondMesh.getMatrixAt(slot, secondMatrix);
          expect(firstMatrix.toArray()).toEqual(secondMatrix.toArray());
          firstMesh.getColorAt(slot, firstColor);
          secondMesh.getColorAt(slot, secondColor);
          expect(firstColor.toArray()).toEqual(secondColor.toArray());
        }
      }
    }
  });

  it('preserves deterministic diversity when occupancy hides and restores trees', () => {
    const view = makeTrees();
    const baseline = snapshot(view);
    const baselineCounts = ARCHETYPE_NAMES.map((name) => mesh(view, name, 'trunks').count);
    view.updateOccupied(new Set(Array.from({ length: 32 }, (_, index) => index)));
    expect(totalCount(view, 'trunks')).toBe(224);
    view.updateOccupied(new Set());
    expect(ARCHETYPE_NAMES.map((name) => mesh(view, name, 'trunks').count)).toEqual(baselineCounts);
    expect(snapshot(view)).toEqual(baseline);
  });
});
