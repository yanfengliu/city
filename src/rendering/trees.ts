import {
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import {
  cellHash01,
  TREE_CANOPY_COLOR,
  TREE_CANOPY_HEIGHT,
  TREE_CANOPY_RADIUS,
  TREE_SCALE_MIN,
  TREE_SCALE_RANGE,
  TREE_TRUNK_COLOR,
  TREE_TRUNK_HEIGHT,
  TREE_TRUNK_RADIUS,
} from './constants';

/** Plain-data view of the tree mask (mirrors protocol TerrainPayload). */
export interface TreesData {
  width: number;
  /** 1 = decorative tree, per cell index (index = y * width + x). */
  trees: Uint8Array;
}

const ROTATION_HASH_OFFSET = 0x9e3779b9;
const UP = new Vector3(0, 1, 0);

/**
 * Decorative trees as two InstancedMeshes (trunks + canopies) sharing one
 * instance layout. Trees on road cells are hidden by rebuilding the instance
 * buffer on each `roads` message (infrequent, so a full rebuild is fine).
 */
export class TreesView {
  readonly group = new Group();
  private readonly trunks: InstancedMesh;
  private readonly canopies: InstancedMesh;
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
    const canopyGeometry = new ConeGeometry(TREE_CANOPY_RADIUS, TREE_CANOPY_HEIGHT, 6);
    canopyGeometry.translate(0, TREE_TRUNK_HEIGHT + TREE_CANOPY_HEIGHT / 2, 0);

    this.trunks = new InstancedMesh(
      trunkGeometry,
      new MeshLambertMaterial({ color: TREE_TRUNK_COLOR }),
      capacity,
    );
    this.canopies = new InstancedMesh(
      canopyGeometry,
      new MeshLambertMaterial({ color: TREE_CANOPY_COLOR }),
      capacity,
    );
    for (const mesh of [this.trunks, this.canopies]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.name = 'trees';
    this.updateRoads(new Set());
  }

  /** Rebuilds instances so trees on road cells disappear (and reappear after bulldozing). */
  updateRoads(roadCells: ReadonlySet<number>): void {
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    let used = 0;
    for (const index of this.treeCells) {
      if (roadCells.has(index)) continue;
      const x = index % this.width;
      const z = Math.floor(index / this.width);
      const s = TREE_SCALE_MIN + cellHash01(index) * TREE_SCALE_RANGE;
      position.set(x + 0.5, 0, z + 0.5);
      rotation.setFromAxisAngle(UP, cellHash01(index + ROTATION_HASH_OFFSET) * Math.PI * 2);
      scale.set(s, s, s);
      matrix.compose(position, rotation, scale);
      this.trunks.setMatrixAt(used, matrix);
      this.canopies.setMatrixAt(used, matrix);
      used++;
    }
    this.trunks.count = used;
    this.canopies.count = used;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.canopies.instanceMatrix.needsUpdate = true;
  }
}
