import { describe, expect, it } from 'vitest';
import { InstancedMesh } from 'three';
import { NetworksView } from '../../src/rendering/networks-mesh';

const pipeMesh = (view: NetworksView): InstancedMesh => {
  const child = view.group.getObjectByName('water-pipes');
  expect(child).toBeInstanceOf(InstancedMesh);
  return child as InstancedMesh;
};

describe('NetworksView', () => {
  it('shows underground pipes only while the Water overlay is active', () => {
    const view = new NetworksView(64);
    const power = { plantCells: [], lineCells: [] };

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
});
