import { describe, expect, it } from 'vitest';
import { Mesh, Vector3 } from 'three';
import type { MeshLambertMaterial } from 'three';
import { StructuresView } from '../../src/rendering/structures-mesh';
import type { ServiceKind } from '../../src/rendering/constants';
import type { TerrainSurfaceView } from '../../src/rendering/terrain-surface';

const serviceKinds: readonly ServiceKind[] = [
  'fireStation', 'police', 'clinic', 'school', 'park',
];

const modelMesh = (view: StructuresView, kind: ServiceKind): Mesh => {
  const child = view.group.getObjectByName(`${kind}-model`);
  expect(child, `${kind}-model`).toBeInstanceOf(Mesh);
  return child as Mesh;
};

const vertexCount = (mesh: Mesh): number =>
  mesh.geometry.getAttribute('position')?.count ?? 0;

const positionBounds = (mesh: Mesh): { min: Vector3; max: Vector3 } => {
  const attr = mesh.geometry.getAttribute('position');
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < attr.count; i++) {
    min.x = Math.min(min.x, attr.getX(i));
    min.y = Math.min(min.y, attr.getY(i));
    min.z = Math.min(min.z, attr.getZ(i));
    max.x = Math.max(max.x, attr.getX(i));
    max.y = Math.max(max.y, attr.getY(i));
    max.z = Math.max(max.z, attr.getZ(i));
  }
  return { min, max };
};

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

describe('StructuresView', () => {
  it('exposes one merged shadow-casting model mesh per service kind', () => {
    const view = new StructuresView();
    for (const kind of serviceKinds) {
      const mesh = modelMesh(view, kind);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      expect((mesh.material as MeshLambertMaterial).vertexColors).toBe(true);
      expect(mesh.visible).toBe(false);
    }
  });

  it('shows and hides service models through the upsert/remove lifecycle', () => {
    const view = new StructuresView();
    view.upsert({ id: 1, service: 'school', x: 10, y: 12, w: 2, h: 2 });

    const school = modelMesh(view, 'school');
    expect(school.visible).toBe(true);
    expect(vertexCount(school)).toBeGreaterThan(0);
    expect(view.count).toBe(1);
    for (const kind of ['fireStation', 'police', 'clinic', 'park'] as const) {
      expect(modelMesh(view, kind).visible).toBe(false);
    }
    const bounds = positionBounds(school);
    expect(bounds.min.x).toBeGreaterThanOrEqual(10 - 0.02);
    expect(bounds.max.x).toBeLessThanOrEqual(12 + 0.02);
    expect(bounds.min.z).toBeGreaterThanOrEqual(12 - 0.02);
    expect(bounds.max.z).toBeLessThanOrEqual(14 + 0.02);

    view.remove(1);
    expect(modelMesh(view, 'school').visible).toBe(false);
    expect(vertexCount(modelMesh(view, 'school'))).toBe(0);
    expect(view.count).toBe(0);

    // Unknown ids are tolerated during defensive reconciliation.
    view.remove(99);
    expect(view.count).toBe(0);
  });

  it('merges every structure of one service into that service mesh', () => {
    const view = new StructuresView();
    view.upsert({ id: 1, service: 'clinic', x: 2, y: 2, w: 2, h: 2 });
    view.upsert({ id: 2, service: 'clinic', x: 20, y: 30, w: 2, h: 2 });

    expect(view.count).toBe(2);
    const bounds = positionBounds(modelMesh(view, 'clinic'));
    expect(bounds.min.x).toBeLessThanOrEqual(4);
    expect(bounds.max.x).toBeGreaterThanOrEqual(20);
    expect(bounds.max.z).toBeGreaterThanOrEqual(30);

    view.remove(2);
    expect(positionBounds(modelMesh(view, 'clinic')).max.x).toBeLessThanOrEqual(4 + 0.02);
  });

  it('rebuilds byte-identically regardless of insertion order', () => {
    const first = new StructuresView();
    const second = new StructuresView();
    const a = { id: 1, service: 'police', x: 4, y: 4, w: 2, h: 2 } as const;
    const b = { id: 2, service: 'police', x: 9, y: 7, w: 2, h: 2 } as const;
    first.upsert({ ...a });
    first.upsert({ ...b });
    second.upsert({ ...b });
    second.upsert({ ...a });

    const geometryA = modelMesh(first, 'police').geometry;
    const geometryB = modelMesh(second, 'police').geometry;
    expect(geometryA.getAttribute('position').array).toEqual(
      geometryB.getAttribute('position').array,
    );
    expect(geometryA.getAttribute('color').array).toEqual(geometryB.getAttribute('color').array);
  });

  it('disposes replaced geometry when a model rebuilds', () => {
    const view = new StructuresView();
    view.upsert({ id: 1, service: 'fireStation', x: 3, y: 3, w: 2, h: 2 });
    const mesh = modelMesh(view, 'fireStation');
    const old = mesh.geometry;
    let disposed = false;
    old.addEventListener('dispose', () => {
      disposed = true;
    });

    view.upsert({ id: 2, service: 'fireStation', x: 8, y: 3, w: 2, h: 2 });
    expect(mesh.geometry).not.toBe(old);
    expect(disposed).toBe(true);
  });

  it('re-levels models when the terrain surface arrives late', () => {
    const view = new StructuresView();
    view.upsert({ id: 1, service: 'school', x: 10, y: 12, w: 2, h: 2 });
    const flatTop = positionBounds(modelMesh(view, 'school')).max.y;

    view.setTerrainSurface(slopedSurface());
    // footprintRange(10, 12, 2, 2).max = 1.2 + 2.8 = 4.0 — the model rides its pad up.
    expect(positionBounds(modelMesh(view, 'school')).max.y).toBeCloseTo(flatTop + 4.0, 5);
  });

  it('moves a structure between service meshes if its service ever changes', () => {
    const view = new StructuresView();
    view.upsert({ id: 1, service: 'school', x: 10, y: 12, w: 2, h: 2 });
    view.upsert({ id: 1, service: 'clinic', x: 10, y: 12, w: 2, h: 2 });

    expect(view.count).toBe(1);
    expect(modelMesh(view, 'school').visible).toBe(false);
    expect(vertexCount(modelMesh(view, 'school'))).toBe(0);
    expect(modelMesh(view, 'clinic').visible).toBe(true);
  });
});
