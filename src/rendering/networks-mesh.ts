import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Group,
  Matrix4,
  MeshLambertMaterial,
} from 'three';
import {
  PIPE_COLOR,
  PIPE_Y,
  PLANT_COLOR,
  POLE_COLOR,
  PUMP_COLOR,
  UTILITY_MESH_CAPACITY,
} from './constants';

const matrix = new Matrix4();

function makeInstanced(
  geometry: BoxGeometry,
  color: number,
  capacity: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, new MeshLambertMaterial({ color: new Color(color) }), capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Renders utility-network geometry from the worker's `networks` message:
 * power plants as tall blocks per footprint cell, power lines as poles,
 * pumps as blue blocks, pipes as flat underground-hint quads.
 */
export class NetworksView {
  readonly group = new Group();
  private readonly plants = makeInstanced(new BoxGeometry(0.94, 1.5, 0.94), PLANT_COLOR, 64);
  private readonly poles = makeInstanced(new BoxGeometry(0.12, 0.9, 0.12), POLE_COLOR, UTILITY_MESH_CAPACITY);
  private readonly pumps = makeInstanced(new BoxGeometry(0.9, 0.8, 0.9), PUMP_COLOR, 32);
  private readonly pipes = makeInstanced(new BoxGeometry(0.6, 0.02, 0.6), PIPE_COLOR, UTILITY_MESH_CAPACITY);
  /** Cells occupied above ground (plants, poles, pumps) — pipes excluded. */
  occupiedCells: ReadonlySet<number> = new Set();

  constructor(private readonly gridWidth: number) {
    this.group.add(this.plants, this.poles, this.pumps, this.pipes);
  }

  private fill(mesh: InstancedMesh, cells: number[], y: number): void {
    const count = Math.min(cells.length, mesh.instanceMatrix.count);
    for (let i = 0; i < count; i++) {
      const cell = cells[i];
      matrix.makeTranslation((cell % this.gridWidth) + 0.5, y, Math.floor(cell / this.gridWidth) + 0.5);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(power: { plantCells: number[]; lineCells: number[] }, water: { pumpCells: number[]; pipeCells: number[] }): void {
    this.fill(this.plants, power.plantCells, 0.75);
    this.fill(this.poles, power.lineCells, 0.45);
    this.fill(this.pumps, water.pumpCells, 0.4);
    this.fill(this.pipes, water.pipeCells, PIPE_Y);
    this.occupiedCells = new Set([...power.plantCells, ...power.lineCells, ...water.pumpCells]);
  }
}
