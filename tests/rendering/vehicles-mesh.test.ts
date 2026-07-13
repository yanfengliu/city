import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { VehiclesView } from '../../src/rendering/vehicles-mesh';

const vehicleMatrix = (view: VehiclesView): Matrix4 => {
  const matrix = new Matrix4();
  view.mesh.getMatrixAt(0, matrix);
  return matrix;
};

const vehiclePose = (view: VehiclesView): { x: number; z: number; yaw: number } => {
  const matrix = vehicleMatrix(view);
  const position = new Vector3().setFromMatrixPosition(matrix);
  return {
    x: position.x,
    z: position.z,
    yaw: Math.atan2(matrix.elements[8], matrix.elements[0]),
  };
};

describe('VehiclesView motion', () => {
  it('starts an early corner update from the currently presented pose', () => {
    let now = 100;
    const view = new VehiclesView(10, () => now);
    view.setRoads(1, [
      { id: 1, cells: [0, 1] },
      { id: 2, cells: [1, 11] },
    ]);

    view.setVehicles(1, [{ id: 7, generation: 0, edge: 1, t: 0.5, reverse: false }]);
    expect(vehiclePose(view)).toEqual({ x: 1, z: 0.5, yaw: Math.PI / 2 });

    now = 200;
    view.setVehicles(1, [{ id: 7, generation: 0, edge: 1, t: 0.9, reverse: false }]);

    now = 250;
    view.updateFrame(now);
    const beforeCornerMessage = vehiclePose(view);
    expect(beforeCornerMessage.x).toBeCloseTo(1.2, 5);
    expect(beforeCornerMessage.z).toBeCloseTo(0.5, 5);
    expect(beforeCornerMessage.yaw).toBeCloseTo(Math.PI / 2, 5);

    view.setVehicles(1, [{ id: 7, generation: 0, edge: 2, t: 0.5, reverse: false }]);
    const afterCornerMessage = vehiclePose(view);
    expect(afterCornerMessage.x).toBeCloseTo(beforeCornerMessage.x, 5);
    expect(afterCornerMessage.z).toBeCloseTo(beforeCornerMessage.z, 5);
    expect(afterCornerMessage.yaw).toBeCloseTo(beforeCornerMessage.yaw, 5);

    now = 275;
    view.updateFrame(now);
    const halfwayThroughTurn = vehiclePose(view);
    expect(halfwayThroughTurn.x).toBeCloseTo(1.35, 5);
    expect(halfwayThroughTurn.z).toBeCloseTo(0.75, 5);
    expect(halfwayThroughTurn.yaw).toBeCloseTo(Math.PI / 4, 5);
  });

  it('places a recycled vehicle id at the new generation pose', () => {
    let now = 100;
    const view = new VehiclesView(10, () => now);
    view.setRoads(1, [
      { id: 1, cells: [0, 1] },
      { id: 2, cells: [1, 11] },
    ]);

    const firstGeneration = [{
      id: 7,
      generation: 3,
      edge: 1,
      t: 0.5,
      reverse: false,
    }];
    view.setVehicles(1, firstGeneration);

    now = 200;
    view.setVehicles(1, [{ ...firstGeneration[0], t: 0.9 }]);
    now = 250;
    view.updateFrame(now);
    expect(vehiclePose(view).x).toBeCloseTo(1.2, 5);

    view.setVehicles(1, [{
      id: 7,
      generation: 4,
      edge: 2,
      t: 0.5,
      reverse: false,
    }]);

    expect(vehiclePose(view)).toEqual({ x: 1.5, z: 1, yaw: 0 });
  });
});
