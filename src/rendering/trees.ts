import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import {
  cellHash01,
  TREE_ARCHETYPES,
  TREE_CANOPY_EMISSIVE_COLOR,
  TREE_CANOPY_EMISSIVE_INTENSITY,
  TREE_CANOPY_HUE_JITTER,
  TREE_CANOPY_LIGHT_JITTER,
  TREE_FOLIAGE_PALETTES,
  TREE_HEIGHT_SCALE_MIN,
  TREE_HEIGHT_SCALE_RANGE,
  TREE_POSITION_JITTER,
  TREE_SCALE_MIN,
  TREE_SCALE_RANGE,
  TREE_WIDTH_SCALE_MIN,
  TREE_WIDTH_SCALE_RANGE,
} from './constants';
import type { TreeArchetypeSpec, TreeCanopyLayerSpec } from './constants';

/** Plain-data view of the tree mask (mirrors protocol TerrainPayload). */
export interface TreesData {
  width: number;
  /** 1 = decorative tree, per cell index (index = y * width + x). */
  trees: Uint8Array;
}

interface TreeArchetypeMeshes {
  spec: TreeArchetypeSpec;
  cells: number[];
  trunks: InstancedMesh;
  lowerCanopies: InstancedMesh;
  upperCanopies: InstancedMesh;
}

const ARCHETYPE_HASH_OFFSET = 0x27d4eb2d;
const PALETTE_HASH_OFFSET = 0x165667b1;
const ROTATION_HASH_OFFSET = 0x9e3779b9;
const WIDTH_HASH_OFFSET = 0x7f4a7c15;
const HEIGHT_HASH_OFFSET = 0x94d049bb;
const POSITION_X_HASH_OFFSET = 0x369dea0f;
const POSITION_Z_HASH_OFFSET = 0xdb4f0b91;
const CANOPY_HUE_HASH_OFFSET = 0x85ebca6b;
const CANOPY_LIGHT_HASH_OFFSET = 0xc2b2ae35;
const UP = new Vector3(0, 1, 0);
const COLOR = new Color();

const hashIndex = (cell: number, offset: number, count: number): number =>
  Math.min(count - 1, Math.floor(cellHash01(cell + offset) * count));

const createCanopyGeometry = (
  layer: TreeCanopyLayerSpec,
  trunkHeight: number,
): BufferGeometry => {
  const centerY = trunkHeight + layer.lift + layer.height / 2;
  if (layer.shape === 'cone') {
    const geometry = new ConeGeometry(layer.radius, layer.height, 6);
    geometry.translate(0, centerY, 0);
    return geometry;
  }
  const geometry = new DodecahedronGeometry(1, 0);
  geometry.scale(layer.radius, layer.height / 2, layer.radius);
  geometry.translate(0, centerY, 0);
  return geometry;
};

const createInstancedLayer = (
  geometry: BufferGeometry,
  material: MeshLambertMaterial,
  capacity: number,
  name: string,
): InstancedMesh => {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.name = name;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return mesh;
};

/**
 * Decorative trees partitioned into deterministic low-poly archetypes.
 * Each archetype stays instanced (three draw calls: trunk/lower/upper), while
 * per-cell hashes choose silhouette, proportions, position, and a coordinated
 * foliage family. Occupancy rebuilds never reroll those visual assignments.
 */
export class TreesView {
  readonly group = new Group();
  private readonly archetypes: TreeArchetypeMeshes[] = [];
  private readonly width: number;

  constructor(data: TreesData) {
    this.width = data.width;
    const cellsByArchetype = TREE_ARCHETYPES.map(() => [] as number[]);
    for (let index = 0; index < data.trees.length; index++) {
      if (data.trees[index] !== 1) continue;
      const archetype = hashIndex(index, ARCHETYPE_HASH_OFFSET, TREE_ARCHETYPES.length);
      cellsByArchetype[archetype].push(index);
    }

    const trunkMaterial = new MeshLambertMaterial({ color: 0xffffff });
    const lowerMaterial = new MeshLambertMaterial({
      color: 0xffffff,
      emissive: TREE_CANOPY_EMISSIVE_COLOR,
      emissiveIntensity: TREE_CANOPY_EMISSIVE_INTENSITY,
    });
    const upperMaterial = new MeshLambertMaterial({
      color: 0xffffff,
      emissive: TREE_CANOPY_EMISSIVE_COLOR,
      emissiveIntensity: TREE_CANOPY_EMISSIVE_INTENSITY,
    });

    TREE_ARCHETYPES.forEach((spec, archetypeIndex) => {
      const cells = cellsByArchetype[archetypeIndex];
      const trunkGeometry = new CylinderGeometry(
        spec.trunkRadius,
        spec.trunkRadius * 1.3,
        spec.trunkHeight,
        5,
      );
      trunkGeometry.translate(0, spec.trunkHeight / 2, 0);
      const prefix = `trees-${spec.name}`;
      const archetype = {
        spec,
        cells,
        trunks: createInstancedLayer(
          trunkGeometry,
          trunkMaterial,
          cells.length,
          `${prefix}-trunks`,
        ),
        lowerCanopies: createInstancedLayer(
          createCanopyGeometry(spec.lower, spec.trunkHeight),
          lowerMaterial,
          cells.length,
          `${prefix}-lower-canopies`,
        ),
        upperCanopies: createInstancedLayer(
          createCanopyGeometry(spec.upper, spec.trunkHeight),
          upperMaterial,
          cells.length,
          `${prefix}-upper-canopies`,
        ),
      };
      this.archetypes.push(archetype);
      this.group.add(archetype.trunks, archetype.lowerCanopies, archetype.upperCanopies);
    });
    this.group.name = 'trees';
    this.updateOccupied(new Set());
  }

  /** Rebuilds instances so trees on occupied cells disappear (and reappear after bulldozing). */
  updateOccupied(occupiedCells: ReadonlySet<number>): void {
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    for (const archetype of this.archetypes) {
      let used = 0;
      for (const index of archetype.cells) {
        if (occupiedCells.has(index)) continue;
        const x = index % this.width;
        const z = Math.floor(index / this.width);
        const uniformScale = TREE_SCALE_MIN + cellHash01(index) * TREE_SCALE_RANGE;
        const widthScale =
          TREE_WIDTH_SCALE_MIN + cellHash01(index + WIDTH_HASH_OFFSET) * TREE_WIDTH_SCALE_RANGE;
        const heightScale =
          TREE_HEIGHT_SCALE_MIN + cellHash01(index + HEIGHT_HASH_OFFSET) * TREE_HEIGHT_SCALE_RANGE;
        position.set(
          x + 0.5 + (cellHash01(index + POSITION_X_HASH_OFFSET) - 0.5) * TREE_POSITION_JITTER * 2,
          0,
          z + 0.5 + (cellHash01(index + POSITION_Z_HASH_OFFSET) - 0.5) * TREE_POSITION_JITTER * 2,
        );
        rotation.setFromAxisAngle(UP, cellHash01(index + ROTATION_HASH_OFFSET) * Math.PI * 2);
        scale.set(
          uniformScale * widthScale,
          uniformScale * heightScale,
          uniformScale * widthScale,
        );
        matrix.compose(position, rotation, scale);
        archetype.trunks.setMatrixAt(used, matrix);
        archetype.lowerCanopies.setMatrixAt(used, matrix);
        archetype.upperCanopies.setMatrixAt(used, matrix);

        const palette =
          TREE_FOLIAGE_PALETTES[
            hashIndex(index, PALETTE_HASH_OFFSET, TREE_FOLIAGE_PALETTES.length)
          ];
        const hueJitter =
          (cellHash01(index + CANOPY_HUE_HASH_OFFSET) - 0.5) * TREE_CANOPY_HUE_JITTER;
        const lightJitter =
          (cellHash01(index + CANOPY_LIGHT_HASH_OFFSET) - 0.5) * TREE_CANOPY_LIGHT_JITTER;
        archetype.trunks.setColorAt(
          used,
          COLOR.setHex(palette.trunk).offsetHSL(hueJitter * 0.25, 0, lightJitter * 0.25),
        );
        archetype.lowerCanopies.setColorAt(
          used,
          COLOR.setHex(palette.lower).offsetHSL(hueJitter, 0, lightJitter),
        );
        archetype.upperCanopies.setColorAt(
          used,
          COLOR.setHex(palette.upper).offsetHSL(hueJitter, 0, lightJitter * 0.8),
        );
        used++;
      }
      for (const mesh of [
        archetype.trunks,
        archetype.lowerCanopies,
        archetype.upperCanopies,
      ]) {
        mesh.count = used;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
