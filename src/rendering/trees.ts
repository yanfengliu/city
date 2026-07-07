import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import {
  cellHash01,
  TREE_CANOPY_COLOR,
  TREE_CANOPY_EMISSIVE_INTENSITY,
  TREE_CANOPY_HIGHLIGHT_COLOR,
  TREE_CANOPY_HEIGHT,
  TREE_CANOPY_HUE_JITTER,
  TREE_CANOPY_LIGHT_JITTER,
  TREE_CANOPY_RADIUS,
  TREE_SCALE_MIN,
  TREE_SCALE_RANGE,
  TREE_TRUNK_COLOR,
  TREE_TRUNK_HEIGHT,
  TREE_TRUNK_RADIUS,
  TREE_UPPER_CANOPY_HEIGHT,
  TREE_UPPER_CANOPY_LIFT,
  TREE_UPPER_CANOPY_RADIUS,
} from './constants';

/** Plain-data view of the tree mask (mirrors protocol TerrainPayload). */
export interface TreesData {
  width: number;
  /** 1 = decorative tree, per cell index (index = y * width + x). */
  trees: Uint8Array;
}

const ROTATION_HASH_OFFSET = 0x9e3779b9;
const CANOPY_HUE_HASH_OFFSET = 0x85ebca6b;
const CANOPY_LIGHT_HASH_OFFSET = 0xc2b2ae35;
const UP = new Vector3(0, 1, 0);
const COLOR = new Color();

/**
 * Decorative trees as synchronized instanced trunks + two-tier canopies.
 * Trees on occupied cells (roads and building footprints) are hidden by
 * rebuilding the instance buffer whenever the occupied set changes
 * (infrequent and cheap, so a full rebuild is fine).
 */
export class TreesView {
  readonly group = new Group();
  private readonly trunks: InstancedMesh;
  private readonly lowerCanopies: InstancedMesh;
  private readonly upperCanopies: InstancedMesh;
  private readonly treeCells: number[] = [];
  private readonly width: number;

  constructor(data: TreesData) {
    this.width = data.width;
    for (let i = 0; i < data.trees.length; i++) {
      if (data.trees[i] === 1) this.treeCells.push(i);
    }
    const capacity = Math.max(1, this.treeCells.length);

    const trunkGeometry = new CylinderGeometry(
      TREE_TRUNK_RADIUS,
      TREE_TRUNK_RADIUS * 1.3,
      TREE_TRUNK_HEIGHT,
      5,
    );
    trunkGeometry.translate(0, TREE_TRUNK_HEIGHT / 2, 0);
    const lowerCanopyGeometry = new ConeGeometry(TREE_CANOPY_RADIUS, TREE_CANOPY_HEIGHT, 6);
    lowerCanopyGeometry.translate(0, TREE_TRUNK_HEIGHT + TREE_CANOPY_HEIGHT / 2, 0);
    const upperCanopyGeometry = new ConeGeometry(TREE_UPPER_CANOPY_RADIUS, TREE_UPPER_CANOPY_HEIGHT, 6);
    upperCanopyGeometry.translate(
      0,
      TREE_TRUNK_HEIGHT + TREE_UPPER_CANOPY_LIFT + TREE_UPPER_CANOPY_HEIGHT / 2,
      0,
    );

    this.trunks = new InstancedMesh(
      trunkGeometry,
      new MeshLambertMaterial({ color: TREE_TRUNK_COLOR }),
      capacity,
    );
    this.lowerCanopies = new InstancedMesh(
      lowerCanopyGeometry,
      new MeshLambertMaterial({
        color: 0xffffff,
        emissive: TREE_CANOPY_COLOR,
        emissiveIntensity: TREE_CANOPY_EMISSIVE_INTENSITY,
      }),
      capacity,
    );
    this.upperCanopies = new InstancedMesh(
      upperCanopyGeometry,
      new MeshLambertMaterial({
        color: 0xffffff,
        emissive: TREE_CANOPY_HIGHLIGHT_COLOR,
        emissiveIntensity: TREE_CANOPY_EMISSIVE_INTENSITY,
      }),
      capacity,
    );
    for (const mesh of [this.trunks, this.lowerCanopies, this.upperCanopies]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    for (const mesh of [this.lowerCanopies, this.upperCanopies]) {
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
    }
    this.group.name = 'trees';
    this.updateOccupied(new Set());
  }

  /** Rebuilds instances so trees on occupied cells disappear (and reappear after bulldozing). */
  updateOccupied(occupiedCells: ReadonlySet<number>): void {
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    let used = 0;
    for (const index of this.treeCells) {
      if (occupiedCells.has(index)) continue;
      const x = index % this.width;
      const z = Math.floor(index / this.width);
      const s = TREE_SCALE_MIN + cellHash01(index) * TREE_SCALE_RANGE;
      position.set(x + 0.5, 0, z + 0.5);
      rotation.setFromAxisAngle(UP, cellHash01(index + ROTATION_HASH_OFFSET) * Math.PI * 2);
      scale.set(s, s, s);
      matrix.compose(position, rotation, scale);
      this.trunks.setMatrixAt(used, matrix);
      this.lowerCanopies.setMatrixAt(used, matrix);
      this.upperCanopies.setMatrixAt(used, matrix);
      const hueJit = (cellHash01(index + CANOPY_HUE_HASH_OFFSET) - 0.5) * TREE_CANOPY_HUE_JITTER;
      const lightJit = (cellHash01(index + CANOPY_LIGHT_HASH_OFFSET) - 0.5) * TREE_CANOPY_LIGHT_JITTER;
      this.lowerCanopies.setColorAt(used, COLOR.setHex(TREE_CANOPY_COLOR).offsetHSL(hueJit, 0, lightJit));
      this.upperCanopies.setColorAt(
        used,
        COLOR.setHex(TREE_CANOPY_HIGHLIGHT_COLOR).offsetHSL(hueJit, 0, lightJit * 0.8),
      );
      used++;
    }
    this.trunks.count = used;
    this.lowerCanopies.count = used;
    this.upperCanopies.count = used;
    for (const mesh of [this.trunks, this.lowerCanopies, this.upperCanopies]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
