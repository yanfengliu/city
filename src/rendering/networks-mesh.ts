import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Group,
  Matrix4,
  MeshLambertMaterial,
} from 'three';
import { PIPE_COLOR, PIPE_Y, PLANT_COLOR, POLE_COLOR, PUMP_COLOR } from './constants';

const matrix = new Matrix4();

/** An InstancedMesh of unit blocks that regrows (power of two) when the cell count exceeds capacity. */
class CellInstances {
  mesh: InstancedMesh;

  constructor(
    private readonly parent: Group,
    private readonly geometry: BoxGeometry,
    private readonly material: MeshLambertMaterial,
    private capacity: number,
  ) {
    this.mesh = this.make();
    parent.add(this.mesh);
  }

  private make(): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, this.capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  fill(cells: number[], gridWidth: number, y: number): void {
    if (cells.length > this.capacity) {
      while (this.capacity < cells.length) this.capacity *= 2;
      this.parent.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = this.make();
      this.parent.add(this.mesh);
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      matrix.makeTranslation((cell % gridWidth) + 0.5, y, Math.floor(cell / gridWidth) + 0.5);
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.count = cells.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Renders utility-network geometry from the worker's `networks` message:
 * power plants as tall blocks per footprint cell, power lines as poles,
 * pumps as blue blocks, pipes as flat underground-hint quads.
 */
export class NetworksView {
  readonly group = new Group();
  private readonly plants: CellInstances;
  private readonly poles: CellInstances;
  private readonly pumps: CellInstances;
  private readonly pipes: CellInstances;
  /** Cells occupied above ground (plants, poles, pumps) — pipes excluded. */
  occupiedCells: ReadonlySet<number> = new Set();

  constructor(private readonly gridWidth: number) {
    const material = (color: number) => new MeshLambertMaterial({ color: new Color(color) });
    this.plants = new CellInstances(this.group, new BoxGeometry(0.94, 1.5, 0.94), material(PLANT_COLOR), 64);
    this.poles = new CellInstances(this.group, new BoxGeometry(0.12, 0.9, 0.12), material(POLE_COLOR), 256);
    this.pumps = new CellInstances(this.group, new BoxGeometry(0.9, 0.8, 0.9), material(PUMP_COLOR), 32);
    this.pipes = new CellInstances(this.group, new BoxGeometry(0.6, 0.02, 0.6), material(PIPE_COLOR), 512);
  }

  update(power: { plantCells: number[]; lineCells: number[] }, water: { pumpCells: number[]; pipeCells: number[] }): void {
    this.plants.fill(power.plantCells, this.gridWidth, 0.75);
    this.poles.fill(power.lineCells, this.gridWidth, 0.45);
    this.pumps.fill(water.pumpCells, this.gridWidth, 0.4);
    this.pipes.fill(water.pipeCells, this.gridWidth, PIPE_Y);
    this.occupiedCells = new Set([...power.plantCells, ...power.lineCells, ...water.pumpCells]);
  }
}
