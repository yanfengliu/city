import { describe, expect, it } from 'vitest';
import { Color, InstancedMesh, Matrix4, Vector3 } from 'three';

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

const ARCHETYPE_NAMES: TreeArchetypeName[] = ['conifer', 'broadleaf', 'columnar'];
const LAYERS = ['trunks', 'lower-canopies', 'upper-canopies'] as const;

const makeTrees = (count = 256): TreesView =>
  new TreesView({ width: 16, trees: new Uint8Array(count).fill(1) });

const mesh = (view: TreesView, archetype: TreeArchetypeName, layer: (typeof LAYERS)[number]): InstancedMesh => {
  const result = view.group.getObjectByName(`trees-${archetype}-${layer}`);
  if (!(result instanceof InstancedMesh)) throw new Error(`missing ${archetype} ${layer}`);
  return result;
};

const dimensions = (target: InstancedMesh): Vector3 => {
  target.geometry.computeBoundingBox();
  const bounds = target.geometry.boundingBox;
  if (!bounds) throw new Error('missing geometry bounds');
  return bounds.getSize(new Vector3());
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

describe('TreesView diversity', () => {
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
