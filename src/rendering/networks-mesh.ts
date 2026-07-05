import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Group,
  Matrix4,
  MeshLambertMaterial,
} from 'three';
import { PIPE_COLOR, PIPE_Y, PLANT_COLOR, POLE_COLOR, PUMP_COLOR, WIRE_COLOR, WIRE_Y } from './constants';
import { deriveLineGeometry } from './line-geometry';

const matrix = new Matrix4();

/** A world-space translation for one instance. */
interface Placement {
  x: number;
  y: number;
  z: number;
}

/** An InstancedMesh of unit blocks that regrows (power of two) when the instance count exceeds capacity. */
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

  private ensureCapacity(count: number): void {
    if (count <= this.capacity) return;
    while (this.capacity < count) this.capacity *= 2;
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = this.make();
    this.parent.add(this.mesh);
  }

  /** One instance per cell, centered on the cell at height `y`. */
  fill(cells: number[], gridWidth: number, y: number): void {
    this.ensureCapacity(cells.length);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      matrix.makeTranslation((cell % gridWidth) + 0.5, y, Math.floor(cell / gridWidth) + 0.5);
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.count = cells.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** One instance per explicit world position (for wire spans between cells). */
  fillAt(positions: Placement[]): void {
    this.ensureCapacity(positions.length);
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      matrix.makeTranslation(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.count = positions.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Renders utility-network geometry from the worker's `networks` message:
 * power plants as tall blocks per footprint cell, power lines as sparse poles
 * with overhead wires strung between them, pumps as blue blocks, pipes as flat
 * underground-hint quads.
 */
export class NetworksView {
  readonly group = new Group();
  private readonly plants: CellInstances;
  private readonly poles: CellInstances;
  private readonly eastWires: CellInstances;
  private readonly southWires: CellInstances;
  private readonly pumps: CellInstances;
  private readonly pipes: CellInstances;
  /** Cells occupied above ground (plants, poles, pumps) — pipes and bare wire excluded. */
  occupiedCells: ReadonlySet<number> = new Set();

  constructor(private readonly gridWidth: number) {
    const material = (color: number) => new MeshLambertMaterial({ color: new Color(color) });
    this.plants = new CellInstances(this.group, new BoxGeometry(0.94, 1.5, 0.94), material(PLANT_COLOR), 64);
    this.poles = new CellInstances(this.group, new BoxGeometry(0.12, 0.9, 0.12), material(POLE_COLOR), 256);
    // Wires: a thin cable spanning one cell along its axis, at pole-top height.
    this.eastWires = new CellInstances(this.group, new BoxGeometry(1, 0.04, 0.04), material(WIRE_COLOR), 256);
    this.southWires = new CellInstances(this.group, new BoxGeometry(0.04, 0.04, 1), material(WIRE_COLOR), 256);
    this.pumps = new CellInstances(this.group, new BoxGeometry(0.9, 0.8, 0.9), material(PUMP_COLOR), 32);
    this.pipes = new CellInstances(this.group, new BoxGeometry(0.6, 0.02, 0.6), material(PIPE_COLOR), 512);
  }

  update(power: { plantCells: number[]; lineCells: number[] }, water: { pumpCells: number[]; pipeCells: number[] }): void {
    const gw = this.gridWidth;
    const geom = deriveLineGeometry(power.lineCells, gw);
    this.plants.fill(power.plantCells, gw, 0.75);
    this.poles.fill(geom.poleCells, gw, 0.45);
    // A span sits midway between the cell and its neighbor, at wire height.
    this.eastWires.fillAt(
      geom.eastSpans.map((c) => ({ x: (c % gw) + 1, y: WIRE_Y, z: Math.floor(c / gw) + 0.5 })),
    );
    this.southWires.fillAt(
      geom.southSpans.map((c) => ({ x: (c % gw) + 0.5, y: WIRE_Y, z: Math.floor(c / gw) + 1 })),
    );
    this.pumps.fill(water.pumpCells, gw, 0.4);
    this.pipes.fill(water.pipeCells, gw, PIPE_Y);
    // Trees clear under structures and actual poles — never under a bare wire span.
    this.occupiedCells = new Set([...power.plantCells, ...geom.poleCells, ...water.pumpCells]);
  }
}
