import { describe, expect, it } from 'vitest';
import { InstancedMesh } from 'three';
import { StructuresView } from '../../src/rendering/structures-mesh';
import type { ServiceKind } from '../../src/rendering/constants';

const serviceKinds: readonly ServiceKind[] = ['fireStation', 'police', 'clinic', 'school'];
const mesh = (view: StructuresView, name: string): InstancedMesh => {
  const child = view.group.getObjectByName(name);
  expect(child).toBeInstanceOf(InstancedMesh);
  return child as InstancedMesh;
};

describe('StructuresView', () => {
  it('keeps a named detail layer synchronized with each service archetype', () => {
    const view = new StructuresView();

    for (const service of serviceKinds) {
      mesh(view, `${service}-walls`);
      mesh(view, `${service}-roofs`);
      mesh(view, `${service}-details`);
    }

    view.upsert({ id: 1, service: 'school', x: 10, y: 12, w: 2, h: 2 });

    expect(mesh(view, 'school-walls').count).toBe(1);
    expect(mesh(view, 'school-roofs').count).toBe(1);
    expect(mesh(view, 'school-details').count).toBe(1);

    view.remove(1);

    expect(mesh(view, 'school-walls').count).toBe(0);
    expect(mesh(view, 'school-roofs').count).toBe(0);
    expect(mesh(view, 'school-details').count).toBe(0);
  });

  it('keeps the detail layer synchronized after capacity growth', () => {
    const view = new StructuresView();

    for (let id = 1; id <= 65; id++) {
      view.upsert({ id, service: 'school', x: id % 10, y: Math.floor(id / 10), w: 2, h: 2 });
    }

    expect(mesh(view, 'school-walls').count).toBe(65);
    expect(mesh(view, 'school-roofs').count).toBe(65);
    expect(mesh(view, 'school-details').count).toBe(65);
  });
});
