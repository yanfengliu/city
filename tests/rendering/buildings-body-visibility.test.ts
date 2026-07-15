import type { InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';

import { BuildingsView, type BuildingRenderView } from '../../src/rendering/buildings-mesh';
import { BUILDING_START_CAPACITY } from '../../src/rendering/constants';

const BODY_SUFFIXES = ['-walls', '-roofs', '-roof-details'] as const;

function view(id: number): BuildingRenderView {
  return { id, x: id % 40, y: 1, w: 1, h: 1, zone: 'R', level: 1, abandoned: false };
}

function isBody(name: string): boolean {
  return BODY_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function bodyMeshes(buildings: BuildingsView): InstancedMesh[] {
  return buildings.group.children.filter(
    (child): child is InstancedMesh => isBody(child.name),
  );
}

describe('BuildingsView body layer visibility', () => {
  it('hides and restores every zone archetype body mesh', () => {
    const buildings = new BuildingsView();
    buildings.upsert(view(1));
    // Three zones times walls, roofs and rooftop details.
    expect(bodyMeshes(buildings)).toHaveLength(9);
    expect(bodyMeshes(buildings).every((mesh) => mesh.visible)).toBe(true);

    buildings.setBodyLayersVisible(false);
    expect(bodyMeshes(buildings).every((mesh) => !mesh.visible)).toBe(true);
    // Only the bodies are hidden; windows and frontages still draw.
    const others = buildings.group.children.filter((child) => !isBody(child.name));
    expect(others).toHaveLength(6);
    expect(others.every((child) => child.visible)).toBe(true);

    buildings.setBodyLayersVisible(true);
    expect(bodyMeshes(buildings).every((mesh) => mesh.visible)).toBe(true);
  });

  it('keeps bodies hidden across a capacity growth', () => {
    const buildings = new BuildingsView();
    buildings.setBodyLayersVisible(false);
    // Growth replaces each mesh with a fresh object, which defaults to visible
    // and would silently double-draw against the voxel lane.
    for (let id = 0; id <= BUILDING_START_CAPACITY + 1; id += 1) buildings.upsert(view(id));

    expect(buildings.count).toBe(BUILDING_START_CAPACITY + 2);
    expect(bodyMeshes(buildings).every((mesh) => !mesh.visible)).toBe(true);
  });
});
