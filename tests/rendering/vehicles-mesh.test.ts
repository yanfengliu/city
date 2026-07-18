import { describe, expect, it } from 'vitest';
import { Color, Matrix4, Vector3 } from 'three';
import { VehiclesView } from '../../src/rendering/vehicles-mesh';
import { VEHICLE_LANE_OFFSET, vehicleAppearance } from '../../src/rendering/vehicle-style';

const vehicleMatrix = (view: VehiclesView, slot = 0): Matrix4 => {
  const matrix = new Matrix4();
  view.mesh.getMatrixAt(slot, matrix);
  return matrix;
};

const vehiclePose = (view: VehiclesView, slot = 0): { x: number; z: number; yaw: number } => {
  const matrix = vehicleMatrix(view, slot);
  const position = new Vector3().setFromMatrixPosition(matrix);
  const basis = new Vector3(matrix.elements[8], matrix.elements[9], matrix.elements[10]);
  return {
    x: position.x,
    z: position.z,
    yaw: Math.atan2(basis.x, basis.z),
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

    // Eastbound: the right-hand lane offset pushes the car toward +z.
    view.setVehicles(1, [{ id: 7, generation: 0, edge: 1, t: 0.5, reverse: false }]);
    const first = vehiclePose(view);
    expect(first.x).toBeCloseTo(1, 5);
    expect(first.z).toBeCloseTo(0.5 + VEHICLE_LANE_OFFSET, 5);
    expect(first.yaw).toBeCloseTo(Math.PI / 2, 5);

    now = 200;
    view.setVehicles(1, [{ id: 7, generation: 0, edge: 1, t: 0.9, reverse: false }]);

    now = 250;
    view.updateFrame(now);
    const beforeCornerMessage = vehiclePose(view);
    expect(beforeCornerMessage.x).toBeCloseTo(1.2, 5);
    expect(beforeCornerMessage.z).toBeCloseTo(0.5 + VEHICLE_LANE_OFFSET, 5);
    expect(beforeCornerMessage.yaw).toBeCloseTo(Math.PI / 2, 5);

    view.setVehicles(1, [{ id: 7, generation: 0, edge: 2, t: 0.5, reverse: false }]);
    const afterCornerMessage = vehiclePose(view);
    expect(afterCornerMessage.x).toBeCloseTo(beforeCornerMessage.x, 5);
    expect(afterCornerMessage.z).toBeCloseTo(beforeCornerMessage.z, 5);
    expect(afterCornerMessage.yaw).toBeCloseTo(beforeCornerMessage.yaw, 5);

    now = 275;
    view.updateFrame(now);
    // Halfway between the presented corner pose and the southbound lane pose
    // (southbound offsets toward -x).
    const halfwayThroughTurn = vehiclePose(view);
    expect(halfwayThroughTurn.x).toBeCloseTo((beforeCornerMessage.x + 1.5 - VEHICLE_LANE_OFFSET) / 2, 5);
    expect(halfwayThroughTurn.z).toBeCloseTo((beforeCornerMessage.z + 1) / 2, 5);
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

    const pose = vehiclePose(view);
    expect(pose.x).toBeCloseTo(1.5 - VEHICLE_LANE_OFFSET, 5);
    expect(pose.z).toBeCloseTo(1, 5);
    expect(pose.yaw).toBeCloseTo(0, 5);
  });
});

describe('VehiclesView right-hand lanes', () => {
  it('keeps opposing traffic on opposite sides of the road center', () => {
    const view = new VehiclesView(10, () => 100);
    view.setRoads(1, [{ id: 1, cells: [0, 1, 2] }]);
    view.setVehicles(1, [
      { id: 1, generation: 0, edge: 1, t: 0.5, reverse: false },
      { id: 2, generation: 0, edge: 1, t: 0.5, reverse: true },
    ]);

    const eastbound = vehiclePose(view, 0);
    const westbound = vehiclePose(view, 1);
    expect(eastbound.x).toBeCloseTo(westbound.x, 5);
    expect(eastbound.z).toBeCloseTo(0.5 + VEHICLE_LANE_OFFSET, 5);
    expect(westbound.z).toBeCloseTo(0.5 - VEHICLE_LANE_OFFSET, 5);
  });
});

describe('VehiclesView identity', () => {
  it('paints each car from its stable identity, not from congestion', () => {
    const view = new VehiclesView(10, () => 100);
    view.setRoads(1, [{ id: 1, cells: [0, 1, 2] }]);
    view.setVehicles(1, [
      { id: 5, generation: 2, edge: 1, t: 0.2, reverse: false },
      { id: 9, generation: 0, edge: 1, t: 0.6, reverse: false },
    ]);

    const color = new Color();
    view.mesh.getColorAt(0, color);
    expect(color.getHex()).toBe(new Color(vehicleAppearance(5, 2).paint).getHex());
    view.mesh.getColorAt(1, color);
    expect(color.getHex()).toBe(new Color(vehicleAppearance(9, 0).paint).getHex());
  });

  it('varies body proportions by identity through the instance matrix', () => {
    const view = new VehiclesView(10, () => 100);
    view.setRoads(1, [{ id: 1, cells: [0, 1, 2] }]);
    view.setVehicles(1, [{ id: 5, generation: 2, edge: 1, t: 0.2, reverse: false }]);

    const look = vehicleAppearance(5, 2);
    const matrix = vehicleMatrix(view);
    const sx = new Vector3(matrix.elements[0], matrix.elements[1], matrix.elements[2]).length();
    const sy = new Vector3(matrix.elements[4], matrix.elements[5], matrix.elements[6]).length();
    const sz = new Vector3(matrix.elements[8], matrix.elements[9], matrix.elements[10]).length();
    expect(sx).toBeCloseTo(look.widthScale, 5);
    expect(sy).toBeCloseTo(look.heightScale, 5);
    expect(sz).toBeCloseTo(look.lengthScale, 5);
  });
});
