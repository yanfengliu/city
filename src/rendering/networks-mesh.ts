import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Group,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { PowerNetworkView, WaterNetworkView } from '../protocol/messages';
import { PIPE_COLOR, PIPE_Y, PLANT_COLOR, POLE_COLOR, PUMP_COLOR, WIRE_COLOR, WIRE_Y } from './constants';
import { deriveLineGeometry } from './line-geometry';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

const matrix = new Matrix4();
const instancePosition = new Vector3();
const instanceRotation = new Euler();
const instanceQuaternion = new Quaternion();
const instanceScale = new Vector3();
const PLANT_BLOCK_HEIGHT = 1.5;

/** A world-space translation for one instance. */
interface Placement {
  x: number;
  y: number;
  z: number;
  rotationX?: number;
  rotationZ?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
}

/** An InstancedMesh of unit blocks that regrows (power of two) when the instance count exceeds capacity. */
class CellInstances {
  mesh: InstancedMesh;
  private visible = true;

  constructor(
    private readonly parent: Group,
    private readonly geometry: BoxGeometry,
    private readonly material: MeshLambertMaterial,
    private capacity: number,
    private readonly name = '',
  ) {
    this.mesh = this.make();
    parent.add(this.mesh);
  }

  private make(): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, this.capacity);
    mesh.name = this.name;
    mesh.visible = this.visible;
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
  fill(
    cells: number[],
    gridWidth: number,
    y: number,
    surface: TerrainSurfaceView,
  ): void {
    this.ensureCapacity(cells.length);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const x = (cell % gridWidth) + 0.5;
      const z = Math.floor(cell / gridWidth) + 0.5;
      matrix.makeTranslation(x, surface.heightAt(x, z) + y, z);
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
      instancePosition.set(p.x, p.y, p.z);
      instanceRotation.set(p.rotationX ?? 0, 0, p.rotationZ ?? 0);
      instanceQuaternion.setFromEuler(instanceRotation);
      instanceScale.set(p.scaleX ?? 1, p.scaleY ?? 1, p.scaleZ ?? 1);
      matrix.compose(instancePosition, instanceQuaternion, instanceScale);
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.count = positions.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.mesh.visible = visible;
  }
}

/**
 * Renders utility-network geometry from the worker's `networks` message:
 * power plants as tall blocks per footprint cell, power lines as sparse poles
 * with overhead wires strung between them, pumps as blue blocks, and pipes as
 * flat underground-hint quads shown only in the Water overlay.
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
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
  private lastPower: PowerNetworkView | null = null;
  private lastWater: WaterNetworkView | null = null;

  constructor(private readonly gridWidth: number) {
    const material = (color: number) => new MeshLambertMaterial({ color: new Color(color) });
    this.plants = new CellInstances(
      this.group,
      new BoxGeometry(0.94, PLANT_BLOCK_HEIGHT, 0.94),
      material(PLANT_COLOR),
      64,
      'power-plants',
    );
    this.poles = new CellInstances(
      this.group,
      new BoxGeometry(0.12, 0.9, 0.12),
      material(POLE_COLOR),
      256,
      'power-poles',
    );
    // Wires: a thin cable spanning one cell along its axis, at pole-top height.
    this.eastWires = new CellInstances(
      this.group,
      new BoxGeometry(1, 0.04, 0.04),
      material(WIRE_COLOR),
      256,
      'power-wires-east',
    );
    this.southWires = new CellInstances(
      this.group,
      new BoxGeometry(0.04, 0.04, 1),
      material(WIRE_COLOR),
      256,
      'power-wires-south',
    );
    this.pumps = new CellInstances(this.group, new BoxGeometry(0.9, 0.8, 0.9), material(PUMP_COLOR), 32);
    this.pipes = new CellInstances(
      this.group,
      new BoxGeometry(0.6, 0.02, 0.6),
      material(PIPE_COLOR),
      512,
      'water-pipes',
    );
    this.pipes.setVisible(false);
  }

  /** Underground pipes are inspectable only while the Water overlay is active. */
  setWaterOverlayActive(active: boolean): void {
    this.pipes.setVisible(active);
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    if (this.lastPower && this.lastWater) this.update(this.lastPower, this.lastWater);
  }

  update(power: PowerNetworkView, water: WaterNetworkView): void {
    this.lastPower = power;
    this.lastWater = water;
    const gw = this.gridWidth;
    const geom = deriveLineGeometry(power.lineCells, gw);
    this.plants.fillAt(this.plantPlacements(power));
    this.poles.fill(geom.poleCells, gw, 0.45, this.surface);
    // Each cable joins the terrain-relative height at both adjacent cell
    // centres, so a line remains connected while crossing a slope.
    this.eastWires.fillAt(
      geom.eastSpans.map((c) => {
        const x0 = (c % gw) + 0.5;
        const x1 = x0 + 1;
        const z = Math.floor(c / gw) + 0.5;
        const y0 = this.surface.heightAt(x0, z) + WIRE_Y;
        const y1 = this.surface.heightAt(x1, z) + WIRE_Y;
        const rise = y1 - y0;
        return {
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
          z,
          rotationZ: Math.atan2(rise, 1),
          scaleX: Math.hypot(1, rise),
        };
      }),
    );
    this.southWires.fillAt(
      geom.southSpans.map((c) => {
        const x = (c % gw) + 0.5;
        const z0 = Math.floor(c / gw) + 0.5;
        const z1 = z0 + 1;
        const y0 = this.surface.heightAt(x, z0) + WIRE_Y;
        const y1 = this.surface.heightAt(x, z1) + WIRE_Y;
        const rise = y1 - y0;
        return {
          x,
          y: (y0 + y1) / 2,
          z: (z0 + z1) / 2,
          rotationX: -Math.atan2(rise, 1),
          scaleZ: Math.hypot(1, rise),
        };
      }),
    );
    this.pumps.fill(water.pumpCells, gw, 0.4, this.surface);
    this.pipes.fill(water.pipeCells, gw, PIPE_Y, this.surface);
    // Trees clear under structures and actual poles — never under a bare wire span.
    this.occupiedCells = new Set([...power.plantCells, ...geom.poleCells, ...water.pumpCells]);
  }

  /** One shared top/base per plant footprint, with downhill walls extended. */
  private plantPlacements(power: PowerNetworkView): Placement[] {
    const placements: Placement[] = [];
    for (const plant of power.plants) {
      const range = this.surface.footprintRange(plant.x, plant.y, plant.w, plant.h);
      const blockHeight = PLANT_BLOCK_HEIGHT + range.max - range.min;
      const centerY = range.min + blockHeight / 2;
      for (const cell of plant.cells) {
        placements.push({
          x: (cell % this.gridWidth) + 0.5,
          y: centerY,
          z: Math.floor(cell / this.gridWidth) + 0.5,
          scaleY: blockHeight / PLANT_BLOCK_HEIGHT,
        });
      }
    }
    return placements;
  }
}
