import { describe, expect, it } from 'vitest';
import { Color, InstancedMesh, Matrix4 } from 'three';
import {
  BUILDING_DETAIL_COLOR,
  BUILDING_FACADE_BASE_Y,
  BUILDING_FACADE_COLORS,
  BUILDING_FACADE_DEPTH,
  BUILDING_ROOF_COLORS,
  BUILDING_START_CAPACITY,
  BUILDING_WALL_COLORS,
  type ZoneKind,
} from '../../src/rendering/constants';
import { BuildingsView } from '../../src/rendering/buildings-mesh';

const zoneKinds: readonly ZoneKind[] = ['R', 'C', 'I'];

const mesh = (view: BuildingsView, name: string): InstancedMesh => {
  const child = view.group.getObjectByName(name);
  expect(child).toBeInstanceOf(InstancedMesh);
  return child as InstancedMesh;
};

const matrixAt = (target: InstancedMesh, slot: number): number[] => {
  const matrix = new Matrix4();
  target.getMatrixAt(slot, matrix);
  return matrix.toArray();
};

const colorAt = (target: InstancedMesh, slot: number): number[] => {
  const color = new Color();
  target.getColorAt(slot, color);
  return color.toArray();
};

const expectCloseArray = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
};

describe('BuildingsView', () => {
  it('keeps named wall, roof, roof-detail, and facade layers synchronized per zone', () => {
    const view = new BuildingsView();

    for (const zone of zoneKinds) {
      mesh(view, `${zone}-walls`);
      mesh(view, `${zone}-roofs`);
      mesh(view, `${zone}-roof-details`);
      mesh(view, `${zone}-facades`);
    }

    view.upsert({ id: 1, zone: 'R', x: 10, y: 12, w: 2, h: 2, level: 1, abandoned: false });

    expect(mesh(view, 'R-walls').count).toBe(1);
    expect(mesh(view, 'R-roofs').count).toBe(1);
    expect(mesh(view, 'R-roof-details').count).toBe(1);
    expect(mesh(view, 'R-facades').count).toBe(1);
    expect(mesh(view, 'R-walls').castShadow).toBe(true);
    expect(mesh(view, 'R-facades').castShadow).toBe(false);
    expect(mesh(view, 'R-facades').receiveShadow).toBe(false);

    const matrix = new Matrix4();
    mesh(view, 'R-facades').getMatrixAt(0, matrix);
    const e = matrix.elements;
    expect(e[10]).toBeCloseTo(BUILDING_FACADE_DEPTH, 5);
    expect(e[13]).toBeCloseTo(BUILDING_FACADE_BASE_Y, 5);
    expect(e[14]).toBeGreaterThan(13);

    view.remove(1);

    expect(mesh(view, 'R-walls').count).toBe(0);
    expect(mesh(view, 'R-roofs').count).toBe(0);
    expect(mesh(view, 'R-roof-details').count).toBe(0);
    expect(mesh(view, 'R-facades').count).toBe(0);
  });

  it('keeps facade instances synchronized after capacity growth', () => {
    const view = new BuildingsView();
    view.upsert({ id: 1, zone: 'C', x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    const beforeMatrix = matrixAt(mesh(view, 'C-facades'), 0);
    const beforeColor = colorAt(mesh(view, 'C-facades'), 0);

    for (let id = 2; id <= BUILDING_START_CAPACITY + 1; id++) {
      view.upsert({ id, zone: 'C', x: id % 24, y: Math.floor(id / 24), w: 1, h: 1, level: 1, abandoned: false });
    }

    expect(mesh(view, 'C-walls').count).toBe(BUILDING_START_CAPACITY + 1);
    expect(mesh(view, 'C-roofs').count).toBe(BUILDING_START_CAPACITY + 1);
    expect(mesh(view, 'C-roof-details').count).toBe(BUILDING_START_CAPACITY + 1);
    expect(mesh(view, 'C-facades').count).toBe(BUILDING_START_CAPACITY + 1);
    expectCloseArray(matrixAt(mesh(view, 'C-facades'), 0), beforeMatrix);
    expectCloseArray(colorAt(mesh(view, 'C-facades'), 0), beforeColor);
  });

  it('swap-removes facade matrices and colors with the other building layers', () => {
    const view = new BuildingsView();

    view.upsert({ id: 1, zone: 'I', x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    view.upsert({ id: 2, zone: 'I', x: 4, y: 4, w: 2, h: 2, level: 1, abandoned: false });

    const facade = mesh(view, 'I-facades');
    const movedMatrix = matrixAt(facade, 1);
    const movedColor = colorAt(facade, 1);

    view.remove(1);

    expect(facade.count).toBe(1);
    expectCloseArray(matrixAt(facade, 0), movedMatrix);
    expectCloseArray(colorAt(facade, 0), movedColor);
  });

  it('uses a cool modern RCI palette instead of warm settlement materials', () => {
    const residentialWall = new Color(BUILDING_WALL_COLORS.R);
    const commercialWall = new Color(BUILDING_WALL_COLORS.C);
    const industrialWall = new Color(BUILDING_WALL_COLORS.I);
    const residentialRoof = new Color(BUILDING_ROOF_COLORS.R);
    const detailColor = new Color(BUILDING_DETAIL_COLOR);
    const commercialFacade = new Color(BUILDING_FACADE_COLORS.C);

    expect(residentialWall.b).toBeGreaterThan(0.5);
    expect(residentialWall.r - residentialWall.b).toBeLessThan(0.12);
    expect(commercialWall.b).toBeGreaterThan(commercialWall.r);
    expect(industrialWall.b).toBeGreaterThanOrEqual(0.5);
    expect(residentialRoof.b).toBeGreaterThan(residentialRoof.r);
    expect(detailColor.b).toBeGreaterThan(detailColor.r);
    expect(commercialFacade.b).toBeGreaterThan(commercialFacade.r);

    const view = new BuildingsView();
    view.upsert({ id: 11, zone: 'R', x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    view.upsert({ id: 12, zone: 'C', x: 3, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    view.upsert({ id: 13, zone: 'I', x: 5, y: 1, w: 1, h: 1, level: 1, abandoned: false });

    const liveResidential = colorAt(mesh(view, 'R-walls'), 0);
    const liveCommercial = colorAt(mesh(view, 'C-walls'), 0);
    const liveIndustrial = colorAt(mesh(view, 'I-walls'), 0);

    expect(liveResidential[2]).toBeGreaterThan(0.46);
    expect(liveCommercial[2]).toBeGreaterThan(liveCommercial[0]);
    expect(liveIndustrial[2]).toBeGreaterThan(0.45);
  });
});
