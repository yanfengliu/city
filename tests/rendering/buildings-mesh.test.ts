import { describe, expect, it } from 'vitest';
import { Color, InstancedMesh, Matrix4 } from 'three';
import type { MeshLambertMaterial } from 'three';
import {
  BUILDING_FACADE_BASE_Y,
  BUILDING_FACADE_DEPTH,
  BUILDING_START_CAPACITY,
  BUILDING_WALL_COLORS,
  type ZoneKind,
} from '../../src/rendering/constants';
import { BuildingsView } from '../../src/rendering/buildings-mesh';
import { TerrainSurface } from '../../src/rendering/terrain-surface';

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

const effectiveColorAt = (target: InstancedMesh, slot: number): Color => {
  const [r, g, b] = colorAt(target, slot);
  const material = target.material as MeshLambertMaterial;
  return new Color(r, g, b).multiply(material.color);
};

const relativeLuminance = (color: Color): number =>
  0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

const toOklab = (color: Color): [number, number, number] => {
  const l = 0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b;
  const m = 0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b;
  const s = 0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
};

const perceptualDistance = (a: Color, b: Color): number => {
  const aLab = toOklab(a);
  const bLab = toOklab(b);
  return Math.hypot(aLab[0] - bLab[0], aLab[1] - bLab[1], aLab[2] - bLab[2]);
};

const expectCloseArray = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
};

describe('BuildingsView', () => {
  it('grounds level foundations at the highest shared terrain corner', () => {
    const view = new BuildingsView();
    const surface = new TerrainSurface({
      width: 4,
      height: 4,
      elevation: new Float32Array(16).fill(0.85),
      seaLevel: 0.35,
      water: new Uint8Array(16),
    });
    view.setTerrainSurface(surface);
    view.upsert({ id: 1, zone: 'R', x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });

    const wallMatrix = matrixAt(mesh(view, 'R-walls'), 0);
    const facadeMatrix = matrixAt(mesh(view, 'R-facades'), 0);
    expect(wallMatrix[13]).toBeCloseTo(surface.maxHeight, 5);
    expect(facadeMatrix[13]).toBeCloseTo(surface.maxHeight + BUILDING_FACADE_BASE_Y, 5);
  });

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

  it('uses a friendly mid-light palette while keeping zones visibly separated', () => {
    const wallColors = zoneKinds.map((zone) => new Color(BUILDING_WALL_COLORS[zone]));

    for (const color of wallColors) {
      expect(relativeLuminance(color)).toBeGreaterThanOrEqual(0.35);
      expect(relativeLuminance(color)).toBeLessThanOrEqual(0.6);
    }
    expect(wallColors[0].g).toBeGreaterThan(Math.max(wallColors[0].r, wallColors[0].b));
    expect(wallColors[1].b).toBeGreaterThan(Math.max(wallColors[1].r, wallColors[1].g));
    expect(wallColors[2].r).toBeGreaterThan(Math.max(wallColors[2].g, wallColors[2].b));
    const rendered = zoneKinds.map((zone) => {
      const view = new BuildingsView();
      view.upsert({ id: 11, zone, x: 1, y: 1, w: 1, h: 1, level: 3, abandoned: false });
      return {
        wall: effectiveColorAt(mesh(view, `${zone}-walls`), 0),
        roof: effectiveColorAt(mesh(view, `${zone}-roofs`), 0),
        detail: effectiveColorAt(mesh(view, `${zone}-roof-details`), 0),
        facade: effectiveColorAt(mesh(view, `${zone}-facades`), 0),
      };
    });
    for (const colors of rendered) {
      expect(relativeLuminance(colors.wall)).toBeGreaterThan(0.3);
      expect(relativeLuminance(colors.wall)).toBeLessThan(0.78);
    }
    for (let i = 0; i < rendered.length; i++) {
      for (let j = i + 1; j < rendered.length; j++) {
        expect(perceptualDistance(rendered[i].wall, rendered[j].wall)).toBeGreaterThanOrEqual(0.09);
        expect(perceptualDistance(rendered[i].roof, rendered[j].roof)).toBeGreaterThanOrEqual(0.08);
        expect(perceptualDistance(rendered[i].detail, rendered[j].detail)).toBeGreaterThanOrEqual(0.08);
        expect(perceptualDistance(rendered[i].facade, rendered[j].facade)).toBeGreaterThanOrEqual(0.1);
      }
    }
  });

  it('uses distinct rooftop and facade proportions for each zone', () => {
    const scaleAt = (target: InstancedMesh): [number, number, number] => {
      const matrix = new Matrix4();
      target.getMatrixAt(0, matrix);
      return [matrix.elements[0], matrix.elements[5], matrix.elements[10]];
    };
    const shapes = zoneKinds.map((zone) => {
      const view = new BuildingsView();
      view.upsert({ id: 11, zone, x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });
      return {
        detail: scaleAt(mesh(view, `${zone}-roof-details`)),
        facade: scaleAt(mesh(view, `${zone}-facades`)),
      };
    });

    expect(shapes[2].detail[0]).toBeGreaterThan(shapes[1].detail[0]);
    expect(shapes[1].detail[0]).toBeGreaterThan(shapes[0].detail[0]);
    expect(shapes[1].detail[1]).toBeGreaterThan(shapes[0].detail[1]);
    expect(shapes[0].detail[1]).toBeGreaterThan(shapes[2].detail[1]);
    expect(shapes[1].facade[0]).toBeGreaterThan(shapes[2].facade[0]);
    expect(shapes[2].facade[0]).toBeGreaterThan(shapes[0].facade[0]);
    expect(shapes[1].facade[1]).toBeGreaterThan(shapes[2].facade[1]);
    expect(shapes[2].facade[1]).toBeGreaterThan(shapes[0].facade[1]);
  });

  it('keeps building bodies non-emissive and hides abandoned facade glow', () => {
    const view = new BuildingsView();
    view.upsert({ id: 1, zone: 'R', x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    view.upsert({ id: 2, zone: 'I', x: 3, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    const liveFacade = matrixAt(mesh(view, 'I-facades'), 0);
    expect(liveFacade[0]).toBeGreaterThan(0);
    view.upsert({ id: 2, zone: 'I', x: 3, y: 1, w: 1, h: 1, level: 1, abandoned: true });
    view.setNightGlow(1);

    const bodyMaterial = mesh(view, 'R-walls').material as MeshLambertMaterial;
    const facadeMaterial = mesh(view, 'R-facades').material as MeshLambertMaterial;
    expect(bodyMaterial.emissive.getHex()).toBe(0x000000);
    view.setNightGlow(0.7);
    expect(facadeMaterial.emissiveIntensity).toBe(0);
    view.setNightGlow(0.8);
    expect(facadeMaterial.emissiveIntensity).toBeGreaterThan(0);
    view.setNightGlow(1);
    expect(facadeMaterial.emissiveIntensity).toBeGreaterThan(0);

    const abandonedFacade = new Matrix4();
    mesh(view, 'I-facades').getMatrixAt(0, abandonedFacade);
    expect(abandonedFacade.elements[0]).toBe(0);
    expect(abandonedFacade.elements[5]).toBe(0);
    expect(abandonedFacade.elements[10]).toBe(0);

    view.upsert({ id: 2, zone: 'I', x: 3, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    const recoveredFacade = new Matrix4();
    mesh(view, 'I-facades').getMatrixAt(0, recoveredFacade);
    expect(recoveredFacade.elements[0]).toBeGreaterThan(0);
    expect(recoveredFacade.elements[5]).toBeGreaterThan(0);
    expect(recoveredFacade.elements[10]).toBeGreaterThan(0);
  });
});
