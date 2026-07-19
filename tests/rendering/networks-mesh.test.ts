import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type MeshLambertMaterial } from 'three';
import { WIRE_Y } from '../../src/rendering/constants';
import { NetworksView } from '../../src/rendering/networks-mesh';
import type { TerrainSurfaceView } from '../../src/rendering/terrain-surface';

const pipeMesh = (view: NetworksView): InstancedMesh => {
  const child = view.group.getObjectByName('water-pipes');
  expect(child).toBeInstanceOf(InstancedMesh);
  return child as InstancedMesh;
};

const namedInstanced = (view: NetworksView, name: string): InstancedMesh => {
  const child = view.group.getObjectByName(name);
  expect(child, name).toBeInstanceOf(InstancedMesh);
  return child as InstancedMesh;
};

const namedMesh = (view: NetworksView, name: string): Mesh => {
  const child = view.group.getObjectByName(name);
  expect(child, name).toBeInstanceOf(Mesh);
  return child as Mesh;
};

const matrixAt = (mesh: InstancedMesh, index: number): Matrix4 => {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
};

const positionBounds = (mesh: Mesh): { min: Vector3; max: Vector3 } => {
  const positions = mesh.geometry.getAttribute('position');
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < positions.count; i++) {
    min.x = Math.min(min.x, positions.getX(i));
    min.y = Math.min(min.y, positions.getY(i));
    min.z = Math.min(min.z, positions.getZ(i));
    max.x = Math.max(max.x, positions.getX(i));
    max.y = Math.max(max.y, positions.getY(i));
    max.z = Math.max(max.z, positions.getZ(i));
  }
  return { min, max };
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

const emptyPower = { plants: [], plantCells: [], lineCells: [] };
const emptyWater = { pumpCells: [], pipeCells: [] };

describe('NetworksView', () => {
  it('exposes solid utility models as pick blockers without thin network geometry', () => {
    const view = new NetworksView(64);
    const blockers = view.solidPickBlockers[0];

    for (const name of ['coal-plants', 'wind-turbines', 'wind-rotors', 'water-pumps']) {
      expect(blockers.getObjectByName(name), name).toBeDefined();
    }
    for (const name of ['power-poles', 'power-wires-east', 'power-wires-south', 'water-pipes']) {
      expect(blockers.getObjectByName(name), name).toBeUndefined();
      expect(view.group.getObjectByName(name), name).toBeDefined();
    }
  });

  it('shows underground pipes only while the Water overlay is active', () => {
    const view = new NetworksView(64);

    view.update(emptyPower, { pumpCells: [], pipeCells: [65, 66] });

    expect(pipeMesh(view).count).toBe(2);
    expect(pipeMesh(view).visible).toBe(false);

    view.setWaterOverlayActive(true);
    expect(pipeMesh(view).visible).toBe(true);

    // Capacity growth replaces the InstancedMesh; visibility must survive it.
    view.update(emptyPower, {
      pumpCells: [],
      pipeCells: Array.from({ length: 513 }, (_, cell) => cell),
    });
    expect(pipeMesh(view).count).toBe(513);
    expect(pipeMesh(view).visible).toBe(true);

    view.setWaterOverlayActive(false);
    expect(pipeMesh(view).visible).toBe(false);
  });

  it('builds a leveled shadow-casting coal complex over its sloped footprint', () => {
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
      emptyWater,
    );

    const coal = namedMesh(view, 'coal-plants');
    expect(coal.visible).toBe(true);
    expect(coal.castShadow).toBe(true);
    expect((coal.material as MeshLambertMaterial).vertexColors).toBe(true);
    const bounds = positionBounds(coal);
    const range = surface.footprintRange(1, 1, 3, 3);
    // Grounded into the lowest corner, level above the highest, inside the footprint.
    expect(bounds.min.y).toBeLessThanOrEqual(range.min + 1e-4);
    expect(bounds.max.y).toBeGreaterThan(range.max + 1.5);
    expect(bounds.min.x).toBeGreaterThanOrEqual(1 - 0.02);
    expect(bounds.max.x).toBeLessThanOrEqual(4 + 0.02);
    expect(bounds.min.z).toBeGreaterThanOrEqual(1 - 0.02);
    expect(bounds.max.z).toBeLessThanOrEqual(4 + 0.02);

    // Occupancy for tree clearing still covers every footprint cell.
    for (const cell of cells) expect(view.occupiedCells.has(cell)).toBe(true);

    view.update(emptyPower, emptyWater);
    expect(namedMesh(view, 'coal-plants').visible).toBe(false);
  });

  it('renders one spinning rotor per wind turbine', () => {
    const view = new NetworksView(64);
    view.update(
      {
        plants: [
          { kind: 'wind', x: 10, y: 12, w: 1, h: 1, cells: [12 * 64 + 10] },
          { kind: 'wind', x: 20, y: 12, w: 1, h: 1, cells: [12 * 64 + 20] },
        ],
        plantCells: [12 * 64 + 10, 12 * 64 + 20],
        lineCells: [],
      },
      emptyWater,
    );

    const towers = namedMesh(view, 'wind-turbines');
    expect(towers.visible).toBe(true);
    expect(positionBounds(towers).max.y).toBeGreaterThan(1.5);

    const rotors = namedInstanced(view, 'wind-rotors');
    expect(rotors.count).toBe(2);
    expect(rotors.castShadow).toBe(false);

    view.updateFrame(1000);
    const early = matrixAt(rotors, 0);
    view.updateFrame(1000);
    expect(matrixAt(rotors, 0)).toEqual(early);

    view.updateFrame(2600);
    const late = matrixAt(rotors, 0);
    const earlyPos = new Vector3();
    const latePos = new Vector3();
    const earlyRot = new Quaternion();
    const lateRot = new Quaternion();
    early.decompose(earlyPos, earlyRot, new Vector3());
    late.decompose(latePos, lateRot, new Vector3());
    // The hub stays fixed while the blades sweep.
    expect(latePos.x).toBeCloseTo(earlyPos.x, 6);
    expect(latePos.y).toBeCloseTo(earlyPos.y, 6);
    expect(latePos.z).toBeCloseTo(earlyPos.z, 6);
    expect(Math.abs(lateRot.angleTo(earlyRot))).toBeGreaterThan(0.1);

    // The two turbines are phase-offset, not synchronized clones.
    const other = new Quaternion();
    matrixAt(rotors, 1).decompose(new Vector3(), other, new Vector3());
    expect(Math.abs(other.angleTo(lateRot))).toBeGreaterThan(0.01);
  });

  it('retires rotors on bulldoze and regrows capacity past eight turbines', () => {
    const view = new NetworksView(64);
    const plants = Array.from({ length: 9 }, (_, i) => ({
      kind: 'wind' as const,
      x: 2 + i * 3,
      y: 5,
      w: 1,
      h: 1,
      cells: [5 * 64 + 2 + i * 3],
    }));
    view.update(
      { plants, plantCells: plants.map((p) => p.cells[0]), lineCells: [] },
      emptyWater,
    );
    // Capacity regrowth replaced the InstancedMesh; the new one is live.
    const rotors = namedInstanced(view, 'wind-rotors');
    expect(rotors.count).toBe(9);
    view.updateFrame(500);
    expect(namedInstanced(view, 'wind-rotors')).toBe(rotors);

    view.update(emptyPower, emptyWater);
    expect(namedInstanced(view, 'wind-rotors').count).toBe(0);
  });

  it('re-aims pumps when the water mask arrives after the first update', () => {
    const gridWidth = 64;
    const cell = 5 * gridWidth + 5;
    const view = new NetworksView(gridWidth);
    view.update(emptyPower, { pumpCells: [cell], pipeCells: [] });
    // No mask yet: the intake falls back to east but stays near the cell.
    expect(positionBounds(namedMesh(view, 'water-pumps')).max.x).toBeLessThan(6.5);

    const water = new Uint8Array(gridWidth * 64);
    water[cell - gridWidth] = 1; // north neighbor is lake
    view.setWater(water);
    // Rebuilt against the mask: the intake now crosses the north edge.
    expect(positionBounds(namedMesh(view, 'water-pumps')).min.z).toBeLessThan(5 - 0.1);
  });

  it('aims the pump intake at the adjacent water cell', () => {
    const gridWidth = 64;
    const cell = 5 * gridWidth + 5;
    const water = new Uint8Array(gridWidth * 64);
    water[cell + 1] = 1; // east neighbor is lake
    const view = new NetworksView(gridWidth);
    view.setWater(water);
    view.update(emptyPower, { pumpCells: [cell], pipeCells: [] });

    const pumps = namedMesh(view, 'water-pumps');
    expect(pumps.visible).toBe(true);
    expect(pumps.castShadow).toBe(true);
    // The intake crosses the shared edge (x = 6) toward the water.
    expect(positionBounds(pumps).max.x).toBeGreaterThan(6.1);
    expect(view.occupiedCells.has(cell)).toBe(true);

    view.update(emptyPower, emptyWater);
    expect(namedMesh(view, 'water-pumps').visible).toBe(false);
  });

  it('joins each cable to the terrain-relative height at both endpoints', () => {
    const view = new NetworksView(10);
    const surface = slopedSurface(10, 10);
    view.setTerrainSurface(surface);
    view.update(
      { plants: [], plantCells: [], lineCells: [11, 12, 21] },
      { pumpCells: [], pipeCells: [] },
    );

    const east = matrixAt(namedInstanced(view, 'power-wires-east'), 0);
    const eastStart = new Vector3(-0.5, 0, 0).applyMatrix4(east);
    const eastEnd = new Vector3(0.5, 0, 0).applyMatrix4(east);
    expect(eastStart.x).toBeCloseTo(1.5, 5);
    expect(eastEnd.x).toBeCloseTo(2.5, 5);
    expect(eastStart.y).toBeCloseTo(surface.heightAt(1.5, 1.5) + WIRE_Y, 5);
    expect(eastEnd.y).toBeCloseTo(surface.heightAt(2.5, 1.5) + WIRE_Y, 5);

    const south = matrixAt(namedInstanced(view, 'power-wires-south'), 0);
    const southStart = new Vector3(0, 0, -0.5).applyMatrix4(south);
    const southEnd = new Vector3(0, 0, 0.5).applyMatrix4(south);
    expect(southStart.z).toBeCloseTo(1.5, 5);
    expect(southEnd.z).toBeCloseTo(2.5, 5);
    expect(southStart.y).toBeCloseTo(surface.heightAt(1.5, 1.5) + WIRE_Y, 5);
    expect(southEnd.y).toBeCloseTo(surface.heightAt(1.5, 2.5) + WIRE_Y, 5);
  });

  it('re-aims pumps when the terrain surface arrives after the first update', () => {
    const gridWidth = 64;
    const cell = 5 * gridWidth + 5;
    const water = new Uint8Array(gridWidth * 64);
    water[cell - gridWidth] = 1; // north neighbor
    const view = new NetworksView(gridWidth);
    view.setWater(water);
    view.update(emptyPower, { pumpCells: [cell], pipeCells: [] });

    const surface = slopedSurface(64, 64);
    view.setTerrainSurface(surface);
    const pumps = namedMesh(view, 'water-pumps');
    // Rebuilt against the sloped surface: the station follows its cell's ground.
    expect(positionBounds(pumps).max.y).toBeGreaterThan(surface.footprintRange(5, 5, 1, 1).max);
  });
});
