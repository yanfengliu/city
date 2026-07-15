import type { InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';

import { BuildingsView, type BuildingRenderView } from '../../src/rendering/buildings-mesh';
import { BUILDING_START_CAPACITY } from '../../src/rendering/constants';

function view(id: number): BuildingRenderView {
  return { id, x: id % 40, y: 1, w: 1, h: 1, zone: 'R', level: 1, abandoned: false };
}

function wallMeshes(buildings: BuildingsView): InstancedMesh[] {
  return buildings.group.children.filter(
    (child): child is InstancedMesh => child.name.endsWith('-walls'),
  );
}

describe('BuildingsView wall visibility', () => {
  it('hides and restores every zone archetype wall mesh', () => {
    const buildings = new BuildingsView();
    buildings.upsert(view(1));
    expect(wallMeshes(buildings).map((mesh) => mesh.visible)).toEqual([true, true, true]);

    buildings.setWallsVisible(false);
    expect(wallMeshes(buildings).every((mesh) => !mesh.visible)).toBe(true);
    // Only the walls are hidden; the other four layers still draw.
    const others = buildings.group.children.filter((child) => !child.name.endsWith('-walls'));
    expect(others.every((child) => child.visible)).toBe(true);

    buildings.setWallsVisible(true);
    expect(wallMeshes(buildings).every((mesh) => mesh.visible)).toBe(true);
  });

  it('keeps walls hidden across a capacity growth', () => {
    const buildings = new BuildingsView();
    buildings.setWallsVisible(false);
    // Growth replaces the wall mesh with a fresh object, which defaults to
    // visible and would silently double-draw against the voxel lane.
    for (let id = 0; id <= BUILDING_START_CAPACITY + 1; id += 1) buildings.upsert(view(id));

    expect(buildings.count).toBe(BUILDING_START_CAPACITY + 2);
    expect(wallMeshes(buildings).every((mesh) => !mesh.visible)).toBe(true);
  });
});
