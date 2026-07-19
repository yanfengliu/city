import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { PowerNetworkView, WaterNetworkView } from '../protocol/messages';
import { PIPE_COLOR, PIPE_Y, POLE_COLOR, WIRE_COLOR, WIRE_Y } from './constants';
import { desaturateToLuminance } from './desaturation';
import { OVERLAY_STATUS_RGBA } from './overlay-semantics';
import { GeometryBuilder } from './geometry-builder';
import { deriveLineGeometry } from './line-geometry';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';
import {
  addCoalPlant,
  addWaterPump,
  addWindTurbine,
  buildWindRotor,
  WIND_FACING,
  windRotorAngle,
  windRotorHubPosition,
} from './utility-structures';

const matrix = new Matrix4();
const instancePosition = new Vector3();
const instanceRotation = new Euler();
const instanceQuaternion = new Quaternion();
const instanceScale = new Vector3(1, 1, 1);
const spinQuaternion = new Quaternion();
const ROTOR_AXIS = new Vector3(0, 0, 1);
const FULL_TURN = Math.PI * 2;
/** Flat tone for the utility family the active overlay is not about. */
const INACTIVE_STRUCTURE_GREY = new Color(0x9aa0a4);

/** A world-space translation for one instance. */
interface Placement {
  x: number;
  y: number;
  z: number;
  rotationX?: number;
  rotationZ?: number;
  scaleX?: number;
  scaleZ?: number;
}

/** An InstancedMesh of unit blocks that regrows (power of two) when the instance count exceeds capacity. */
class CellInstances {
  mesh: InstancedMesh;
  private visible = true;

  constructor(
    private readonly parent: Group,
    private readonly geometry: BoxGeometry,
    /** Readable so the overlay tint can shift this family's colour. */
    readonly material: MeshLambertMaterial,
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
      instanceScale.set(p.scaleX ?? 1, 1, p.scaleZ ?? 1);
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

/** One rotor hub with its phase cell, mirrored from the wind plants. */
interface RotorPlacement {
  x: number;
  y: number;
  z: number;
  cell: number;
}

/**
 * Renders utility-network geometry from the worker's `networks` message.
 * Coal plants, wind-turbine masts, and water pumps are detailed merged
 * vertex-colored models; turbine rotors are one instanced mesh spun from the
 * presentation clock; power lines stay sparse poles with strung cables; pipes
 * remain flat underground hints shown only in the Water overlay.
 */
export class NetworksView {
  readonly group = new Group();
  /** Solid utility models that can visually hide a pedestrian; thin wires/pipes stay excluded. */
  private readonly solidStructures = new Group();
  readonly solidPickBlockers: readonly Group[] = [this.solidStructures];
  private readonly coalPlants: Mesh;
  private readonly windTurbines: Mesh;
  private readonly waterPumps: Mesh;
  private readonly poles: CellInstances;
  private readonly eastWires: CellInstances;
  private readonly southWires: CellInstances;
  private readonly pipes: CellInstances;
  private readonly rotorGeometry: BufferGeometry;
  private readonly rotorMaterial: MeshLambertMaterial;
  private rotors: InstancedMesh;
  private rotorCapacity = 8;
  private rotorPlacements: RotorPlacement[] = [];
  /** Input signature of the last structure rebuild (empty forces a rebuild). */
  private lastStructuresKey = '';
  /** Cells occupied above ground (plants, poles, pumps) — pipes and bare wire excluded. */
  occupiedCells: ReadonlySet<number> = new Set();
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
  /** Terrain water mask from boot; aims each pump's intake at its water cell. */
  private water: Uint8Array | null = null;
  /** Materials the overlay tint drives, with their untinted colours. */
  private readonly tintables: Array<{
    material: MeshLambertMaterial;
    utility: 'power' | 'water';
    original: Color;
    /** Whether this family paints itself from vertex colours. */
    vertexColors: boolean;
  }>;
  private lastPower: PowerNetworkView | null = null;
  private lastWater: WaterNetworkView | null = null;
  private lastNow = 0;

  constructor(private readonly gridWidth: number) {
    this.solidStructures.name = 'solid-utility-pick-blockers';
    this.group.add(this.solidStructures);
    const material = (color: number) => new MeshLambertMaterial({ color: new Color(color) });
    this.coalPlants = this.makeStructureMesh('coal-plants');
    this.windTurbines = this.makeStructureMesh('wind-turbines');
    this.waterPumps = this.makeStructureMesh('water-pumps');
    const rotorBuilder = new GeometryBuilder();
    buildWindRotor(rotorBuilder);
    this.rotorGeometry = rotorBuilder.build();
    this.rotorMaterial = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    this.rotors = this.makeRotorMesh();
    this.solidStructures.add(this.rotors);
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
    this.pipes = new CellInstances(
      this.group,
      new BoxGeometry(0.6, 0.02, 0.6),
      material(PIPE_COLOR),
      512,
      'water-pipes',
    );
    this.pipes.setVisible(false);
    // Overlay tinting needs each material's untinted colour to restore, and
    // which utility it belongs to so only the inspected one lights up.
    const families: Array<[MeshLambertMaterial, 'power' | 'water']> = [
      [this.coalPlants.material as MeshLambertMaterial, 'power'],
      [this.windTurbines.material as MeshLambertMaterial, 'power'],
      [this.rotorMaterial, 'power'],
      [this.poles.material, 'power'],
      [this.eastWires.material, 'power'],
      [this.southWires.material, 'power'],
      [this.waterPumps.material as MeshLambertMaterial, 'water'],
      [this.pipes.material, 'water'],
    ];
    this.tintables = families.map(([material, utility]) => ({
      material,
      utility,
      original: material.color.clone(),
      vertexColors: material.vertexColors,
    }));
  }

  /**
   * Tints the utility infrastructure to match the active overlay, so plants,
   * poles, wires, pumps, and pipes read in the same green family as the
   * buildings they serve.
   *
   * `'power'`/`'water'` light that utility's hardware and grey the other's;
   * `'grey'` greys all of it (an overlay is up, but it says nothing about
   * utilities); `null` restores the untinted world. These meshes opt out of
   * the scene desaturation shader, so the grey cases are produced here.
   *
   * The materials multiply their colour with any vertex colours, so a merged
   * structure keeps its internal shading while shifting into the status hue.
   */
  setOverlayTint(mode: 'power' | 'water' | 'grey' | null): void {
    const [r, g, b] = OVERLAY_STATUS_RGBA.source;
    for (const entry of this.tintables) {
      const { material, utility, original, vertexColors } = entry;
      // A merged structure carries its palette in vertex colours, which a
      // material colour can only multiply — never neutralise. A "de-emphasised"
      // pump would still read bright blue, and a saturated model tinted blue
      // comes out muddy. So any tinted state paints one flat tone and leans on
      // Lambert shading to keep the silhouette; StructuresView does the same.
      const greyed = mode !== null && utility !== mode;
      const wantVertexColors = vertexColors && mode === null;
      if (material.vertexColors !== wantVertexColors) {
        material.vertexColors = wantVertexColors;
        material.needsUpdate = true;
      }
      if (mode === null) {
        material.color.copy(original);
      } else if (!greyed) {
        material.color.setRGB(r / 255, g / 255, b / 255);
      } else {
        material.color.copy(vertexColors ? INACTIVE_STRUCTURE_GREY : original);
        desaturateToLuminance(material.color);
      }
    }
  }

  /** Empty merged mesh for one structure family; geometry swaps in on update. */
  private makeStructureMesh(name: string): Mesh {
    const mesh = new Mesh(
      new BufferGeometry(),
      new MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
    );
    mesh.name = name;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.solidStructures.add(mesh);
    return mesh;
  }

  /** Rotors move every frame, so they never cast into the cached shadow map. */
  private makeRotorMesh(): InstancedMesh {
    const mesh = new InstancedMesh(this.rotorGeometry, this.rotorMaterial, this.rotorCapacity);
    mesh.name = 'wind-rotors';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  private swapGeometry(mesh: Mesh, geometry: BufferGeometry): void {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old.dispose();
    const positions = geometry.getAttribute('position');
    mesh.visible = positions !== undefined && positions.count > 0;
  }

  /** Underground pipes are inspectable only while the Water overlay is active. */
  setWaterOverlayActive(active: boolean): void {
    this.pipes.setVisible(active);
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    this.lastStructuresKey = '';
    if (this.lastPower && this.lastWater) this.update(this.lastPower, this.lastWater);
  }

  /** Terrain water mask from boot; re-aims pumps that arrived earlier. */
  setWater(water: Uint8Array): void {
    this.water = water;
    this.lastStructuresKey = '';
    if (this.lastPower && this.lastWater) this.update(this.lastPower, this.lastWater);
  }

  update(power: PowerNetworkView, water: WaterNetworkView): void {
    this.lastPower = power;
    this.lastWater = water;
    const gw = this.gridWidth;
    const geom = deriveLineGeometry(power.lineCells, gw);

    // Structure models rebuild only when plants/pumps (or, via the setters
    // above, terrain/water inputs) change; pipe/wire-only messages skip them.
    const structuresKey = `${JSON.stringify(power.plants)}|${water.pumpCells.join(',')}`;
    if (structuresKey !== this.lastStructuresKey) {
      this.lastStructuresKey = structuresKey;
      const coal = new GeometryBuilder();
      const turbines = new GeometryBuilder();
      this.rotorPlacements = [];
      for (const plant of power.plants) {
        switch (plant.kind) {
          case 'wind': {
            addWindTurbine(turbines, this.surface, plant.x, plant.y);
            const hub = windRotorHubPosition(this.surface, plant.x, plant.y);
            this.rotorPlacements.push({ ...hub, cell: plant.y * gw + plant.x });
            break;
          }
          case 'coal': {
            addCoalPlant(coal, this.surface, plant.x, plant.y, plant.w, plant.h);
            break;
          }
          default: {
            const unhandled: never = plant.kind;
            throw new Error(`unhandled power plant kind: ${String(unhandled)}`);
          }
        }
      }
      this.swapGeometry(this.coalPlants, coal.build());
      this.swapGeometry(this.windTurbines, turbines.build());
      this.syncRotors();

      const pumps = new GeometryBuilder();
      const gridHeight = this.water ? this.water.length / gw : 0;
      const isWater = (cell: number): boolean => this.water !== null && this.water[cell] === 1;
      for (const cell of water.pumpCells) {
        addWaterPump(pumps, this.surface, gw, gridHeight, cell, isWater);
      }
      this.swapGeometry(this.waterPumps, pumps.build());
    }

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
    this.pipes.fill(water.pipeCells, gw, PIPE_Y, this.surface);
    // Trees clear under structures and actual poles — never under a bare wire span.
    this.occupiedCells = new Set([...power.plantCells, ...geom.poleCells, ...water.pumpCells]);
  }

  /** Advances the presentation clock: turbine rotors keep spinning while paused. */
  updateFrame(nowMs: number): void {
    this.lastNow = nowMs;
    this.syncRotors();
  }

  private syncRotors(): void {
    const placements = this.rotorPlacements;
    // Skip the per-frame instance upload entirely while no turbines exist.
    if (placements.length === 0 && this.rotors.count === 0) return;
    if (placements.length > this.rotorCapacity) {
      while (this.rotorCapacity < placements.length) this.rotorCapacity *= 2;
      this.solidStructures.remove(this.rotors);
      this.rotors.dispose();
      this.rotors = this.makeRotorMesh();
      this.solidStructures.add(this.rotors);
    }
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      instancePosition.set(p.x, p.y, p.z);
      spinQuaternion.setFromAxisAngle(ROTOR_AXIS, windRotorAngle(this.lastNow, p.cell) % FULL_TURN);
      instanceQuaternion.copy(WIND_FACING).multiply(spinQuaternion);
      instanceScale.set(1, 1, 1);
      matrix.compose(instancePosition, instanceQuaternion, instanceScale);
      this.rotors.setMatrixAt(i, matrix);
    }
    this.rotors.count = placements.length;
    this.rotors.instanceMatrix.needsUpdate = true;
  }
}
