import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { WIRE_Y } from '../../src/rendering/constants';
import { NetworksView } from '../../src/rendering/networks-mesh';
import type { TerrainSurfaceView } from '../../src/rendering/terrain-surface';

const pipeMesh = (view: NetworksView): InstancedMesh => {
  const child = view.group.getObjectByName('water-pipes');
  expect(child).toBeInstanceOf(InstancedMesh);
  return child as InstancedMesh;
};

const namedMesh = (view: NetworksView, name: string): InstancedMesh => {
  const child = view.group.getObjectByName(name);
  expect(child).toBeInstanceOf(InstancedMesh);
  return child as InstancedMesh;
};

const matrixAt = (mesh: InstancedMesh, index: number): Matrix4 => {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
};

const slopedSurface = (width: number, height: number): TerrainSurfaceView => {
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
    footprintRange: (x, z, w, h) => ({
      min: heightAt(x, z),
      max: heightAt(x + w, z + h),
    }),
  };
};

describe('NetworksView', () => {
  it('shows underground pipes only while the Water overlay is active', () => {
    const view = new NetworksView(64);
    const power = { plants: [], plantCells: [], lineCells: [] };

    view.update(power, { pumpCells: [], pipeCells: [65, 66] });

    expect(pipeMesh(view).count).toBe(2);
    expect(pipeMesh(view).visible).toBe(false);

    view.setWaterOverlayActive(true);
    expect(pipeMesh(view).visible).toBe(true);

    // Capacity growth replaces the InstancedMesh; visibility must survive it.
    view.update(power, {
      pumpCells: [],
      pipeCells: Array.from({ length: 513 }, (_, cell) => cell),
    });
    expect(pipeMesh(view).count).toBe(513);
    expect(pipeMesh(view).visible).toBe(true);

    view.setWaterOverlayActive(false);
    expect(pipeMesh(view).visible).toBe(false);
  });

  it('levels a multi-cell plant over its full footprint', () => {
    const view = new NetworksView(64);
    const surface = slopedSurface(64, 64);
    const cells = [65, 66, 67, 129, 130, 131, 193, 194, 195];
    view.setTerrainSurface(surface);
    view.update(
      {
        plants: [{ kind: 'coal', x: 1, y: 1, w: 3, h: 3, cells }],
        plantCells: cells,
        lineCells: [],
      },
      { pumpCells: [], pipeCells: [] },
    );

    const plants = namedMesh(view, 'power-plants');
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const expectedBase = surface.heightAt(1, 1);
    const expectedTop = surface.heightAt(4, 4) + 1.5;
    expect(plants.count).toBe(9);
    for (let i = 0; i < plants.count; i++) {
      matrixAt(plants, i).decompose(position, rotation, scale);
      expect(position.y - (1.5 * scale.y) / 2).toBeCloseTo(expectedBase, 5);
      expect(position.y + (1.5 * scale.y) / 2).toBeCloseTo(expectedTop, 5);
    }
  });

  it('joins each cable to the terrain-relative height at both endpoints', () => {
    const view = new NetworksView(10);
    const surface = slopedSurface(10, 10);
    view.setTerrainSurface(surface);
    view.update(
      { plants: [], plantCells: [], lineCells: [11, 12, 21] },
      { pumpCells: [], pipeCells: [] },
    );

    const east = matrixAt(namedMesh(view, 'power-wires-east'), 0);
    const eastStart = new Vector3(-0.5, 0, 0).applyMatrix4(east);
    const eastEnd = new Vector3(0.5, 0, 0).applyMatrix4(east);
    expect(eastStart.x).toBeCloseTo(1.5, 5);
    expect(eastEnd.x).toBeCloseTo(2.5, 5);
    expect(eastStart.y).toBeCloseTo(surface.heightAt(1.5, 1.5) + WIRE_Y, 5);
    expect(eastEnd.y).toBeCloseTo(surface.heightAt(2.5, 1.5) + WIRE_Y, 5);

    const south = matrixAt(namedMesh(view, 'power-wires-south'), 0);
    const southStart = new Vector3(0, 0, -0.5).applyMatrix4(south);
    const southEnd = new Vector3(0, 0, 0.5).applyMatrix4(south);
    expect(southStart.z).toBeCloseTo(1.5, 5);
    expect(southEnd.z).toBeCloseTo(2.5, 5);
    expect(southStart.y).toBeCloseTo(surface.heightAt(1.5, 1.5) + WIRE_Y, 5);
    expect(southEnd.y).toBeCloseTo(surface.heightAt(1.5, 2.5) + WIRE_Y, 5);
  });
});
