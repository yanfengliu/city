import { describe, expect, it } from 'vitest';
import { Color, InstancedMesh, Matrix4, Raycaster, Vector3 } from 'three';
import type { MeshLambertMaterial } from 'three';
import {
  BUILDING_ABANDONED_FRONTAGE_COLOR,
  BUILDING_FRONTAGE_HEIGHT_MAX,
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
    const windowMatrix = matrixAt(mesh(view, 'R-windows'), 0);
    const frontageMatrix = matrixAt(mesh(view, 'R-frontages'), 0);
    expect(wallMatrix[13]).toBeCloseTo(surface.maxHeight, 5);
    expect(windowMatrix[13]).toBeCloseTo(surface.maxHeight, 5);
    expect(frontageMatrix[13]).toBeCloseTo(surface.maxHeight, 5);
  });

  it('keeps five named instanced layers synchronized per zone', () => {
    const view = new BuildingsView();

    for (const zone of zoneKinds) {
      mesh(view, `${zone}-walls`);
      mesh(view, `${zone}-roofs`);
      mesh(view, `${zone}-roof-details`);
      mesh(view, `${zone}-windows`);
      mesh(view, `${zone}-frontages`);
    }
    expect(view.group.children).toHaveLength(15);

    view.upsert({ id: 1, zone: 'R', x: 10, y: 12, w: 2, h: 2, level: 1, abandoned: false });

    expect(mesh(view, 'R-walls').count).toBe(1);
    expect(mesh(view, 'R-roofs').count).toBe(1);
    expect(mesh(view, 'R-roof-details').count).toBe(1);
    expect(mesh(view, 'R-windows').count).toBe(1);
    expect(mesh(view, 'R-frontages').count).toBe(1);
    expect(mesh(view, 'R-walls').castShadow).toBe(true);
    expect(mesh(view, 'R-windows').castShadow).toBe(false);
    expect(mesh(view, 'R-windows').receiveShadow).toBe(false);
    expect(mesh(view, 'R-frontages').castShadow).toBe(false);
    expect(mesh(view, 'R-frontages').receiveShadow).toBe(false);

    const matrix = new Matrix4();
    mesh(view, 'R-frontages').getMatrixAt(0, matrix);
    const e = matrix.elements;
    expect(e[0]).toBeGreaterThan(1);
    expect(e[5]).toBeGreaterThan(0);
    expect(e[10]).toBeGreaterThan(1);
    expect(e[13]).toBeCloseTo(0, 5);
    expect(e[14]).toBeCloseTo(13, 5);

    view.remove(1);

    expect(mesh(view, 'R-walls').count).toBe(0);
    expect(mesh(view, 'R-roofs').count).toBe(0);
    expect(mesh(view, 'R-roof-details').count).toBe(0);
    expect(mesh(view, 'R-windows').count).toBe(0);
    expect(mesh(view, 'R-frontages').count).toBe(0);
  });

  it('invalidates cached instance bounds after count and matrix changes', () => {
    const view = new BuildingsView();
    const walls = mesh(view, 'R-walls');
    walls.computeBoundingSphere();
    expect(walls.boundingSphere?.radius).toBe(-1);

    view.upsert({ id: 1, zone: 'R', x: 2, y: 3, w: 1, h: 1, level: 1, abandoned: false });
    expect(walls.boundingSphere).toBeNull();
    expect(
      new Raycaster(new Vector3(2.5, 10, 3.5), new Vector3(0, -1, 0))
        .intersectObject(walls, false),
    ).not.toHaveLength(0);
    expect(walls.boundingSphere).not.toBeNull();

    view.upsert({ id: 1, zone: 'R', x: 40, y: 42, w: 1, h: 1, level: 1, abandoned: false });
    expect(walls.boundingSphere).toBeNull();
    expect(
      new Raycaster(new Vector3(40.5, 10, 42.5), new Vector3(0, -1, 0))
        .intersectObject(walls, false),
    ).not.toHaveLength(0);

    view.remove(1);
    expect(walls.boundingSphere).toBeNull();
  });

  it('keeps window and frontage instances synchronized after capacity growth', () => {
    const view = new BuildingsView();
    view.upsert({ id: 1, zone: 'C', x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    const beforeWindowMatrix = matrixAt(mesh(view, 'C-windows'), 0);
    const beforeWindowColor = colorAt(mesh(view, 'C-windows'), 0);
    const beforeFrontageMatrix = matrixAt(mesh(view, 'C-frontages'), 0);
    const beforeFrontageColor = colorAt(mesh(view, 'C-frontages'), 0);

    for (let id = 2; id <= BUILDING_START_CAPACITY + 1; id++) {
      view.upsert({ id, zone: 'C', x: id % 24, y: Math.floor(id / 24), w: 1, h: 1, level: 1, abandoned: false });
    }

    expect(mesh(view, 'C-walls').count).toBe(BUILDING_START_CAPACITY + 1);
    expect(mesh(view, 'C-roofs').count).toBe(BUILDING_START_CAPACITY + 1);
    expect(mesh(view, 'C-roof-details').count).toBe(BUILDING_START_CAPACITY + 1);
    expect(mesh(view, 'C-windows').count).toBe(BUILDING_START_CAPACITY + 1);
    expect(mesh(view, 'C-frontages').count).toBe(BUILDING_START_CAPACITY + 1);
    expectCloseArray(matrixAt(mesh(view, 'C-windows'), 0), beforeWindowMatrix);
    expectCloseArray(colorAt(mesh(view, 'C-windows'), 0), beforeWindowColor);
    expectCloseArray(matrixAt(mesh(view, 'C-frontages'), 0), beforeFrontageMatrix);
    expectCloseArray(colorAt(mesh(view, 'C-frontages'), 0), beforeFrontageColor);
  });

  it('swap-removes window and frontage matrices and colors with the other building layers', () => {
    const view = new BuildingsView();

    view.upsert({ id: 1, zone: 'I', x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    view.upsert({ id: 2, zone: 'I', x: 4, y: 4, w: 2, h: 2, level: 1, abandoned: false });

    const windows = mesh(view, 'I-windows');
    const frontages = mesh(view, 'I-frontages');
    const movedWindowMatrix = matrixAt(windows, 1);
    const movedWindowColor = colorAt(windows, 1);
    const movedFrontageMatrix = matrixAt(frontages, 1);
    const movedFrontageColor = colorAt(frontages, 1);

    view.remove(1);

    expect(windows.count).toBe(1);
    expect(frontages.count).toBe(1);
    expectCloseArray(matrixAt(windows, 0), movedWindowMatrix);
    expectCloseArray(colorAt(windows, 0), movedWindowColor);
    expectCloseArray(matrixAt(frontages, 0), movedFrontageMatrix);
    expectCloseArray(colorAt(frontages, 0), movedFrontageColor);
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
        window: effectiveColorAt(mesh(view, `${zone}-windows`), 0),
        frontage: effectiveColorAt(mesh(view, `${zone}-frontages`), 0),
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
        expect(perceptualDistance(rendered[i].window, rendered[j].window)).toBeGreaterThanOrEqual(0.04);
        expect(perceptualDistance(rendered[i].frontage, rendered[j].frontage)).toBeGreaterThanOrEqual(0.08);
      }
    }
  });

  it('uses distinct rooftop and physical feature geometry for each zone', () => {
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
        windowVertices: mesh(view, `${zone}-windows`).geometry.getAttribute('position').count,
        frontageVertices: mesh(view, `${zone}-frontages`).geometry.getAttribute('position').count,
      };
    });

    expect(shapes[2].detail[0]).toBeGreaterThan(shapes[1].detail[0]);
    expect(shapes[1].detail[0]).toBeGreaterThan(shapes[0].detail[0]);
    expect(shapes[1].detail[1]).toBeGreaterThan(shapes[0].detail[1]);
    expect(shapes[0].detail[1]).toBeGreaterThan(shapes[2].detail[1]);
    expect(new Set(shapes.map((shape) => shape.windowVertices)).size).toBe(3);
    expect(new Set(shapes.map((shape) => shape.frontageVertices)).size).toBe(3);
  });

  it('keeps frontage assemblies at ground-floor scale on higher-level buildings', () => {
    const view = new BuildingsView();
    view.upsert({ id: 11, zone: 'C', x: 1, y: 1, w: 1, h: 1, level: 3, abandoned: false });

    const windowMatrix = matrixAt(mesh(view, 'C-windows'), 0);
    const frontageMatrix = matrixAt(mesh(view, 'C-frontages'), 0);
    expect(frontageMatrix[5]).toBeCloseTo(BUILDING_FRONTAGE_HEIGHT_MAX, 5);
    expect(windowMatrix[5]).toBeGreaterThan(frontageMatrix[5]);
  });

  it('lights only live windows while retaining non-emissive abandoned frontage', () => {
    const view = new BuildingsView();
    view.upsert({ id: 1, zone: 'R', x: 1, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    view.upsert({ id: 2, zone: 'I', x: 3, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    const liveWindows = matrixAt(mesh(view, 'I-windows'), 0);
    expect(liveWindows[0]).toBeGreaterThan(0);
    view.upsert({ id: 2, zone: 'I', x: 3, y: 1, w: 1, h: 1, level: 1, abandoned: true });
    view.setNightGlow(1);

    const bodyMaterial = mesh(view, 'R-walls').material as MeshLambertMaterial;
    const windowMaterial = mesh(view, 'R-windows').material as MeshLambertMaterial;
    const frontageMaterial = mesh(view, 'R-frontages').material as MeshLambertMaterial;
    expect(bodyMaterial.emissive.getHex()).toBe(0x000000);
    expect(frontageMaterial.emissive.getHex()).toBe(0x000000);
    view.setNightGlow(0.7);
    expect(windowMaterial.emissiveIntensity).toBe(0);
    view.setNightGlow(0.8);
    expect(windowMaterial.emissiveIntensity).toBeGreaterThan(0);
    view.setNightGlow(1);
    expect(windowMaterial.emissiveIntensity).toBeGreaterThan(0);

    const abandonedWindows = new Matrix4();
    mesh(view, 'I-windows').getMatrixAt(0, abandonedWindows);
    expect(abandonedWindows.elements[0]).toBe(0);
    expect(abandonedWindows.elements[5]).toBe(0);
    expect(abandonedWindows.elements[10]).toBe(0);
    const abandonedFrontage = matrixAt(mesh(view, 'I-frontages'), 0);
    expect(abandonedFrontage[0]).toBeGreaterThan(0);
    expectCloseArray(colorAt(mesh(view, 'I-frontages'), 0), new Color(BUILDING_ABANDONED_FRONTAGE_COLOR).toArray());

    view.upsert({ id: 2, zone: 'I', x: 3, y: 1, w: 1, h: 1, level: 1, abandoned: false });
    const recoveredWindows = new Matrix4();
    mesh(view, 'I-windows').getMatrixAt(0, recoveredWindows);
    expect(recoveredWindows.elements[0]).toBeGreaterThan(0);
    expect(recoveredWindows.elements[5]).toBeGreaterThan(0);
    expect(recoveredWindows.elements[10]).toBeGreaterThan(0);
  });
});
