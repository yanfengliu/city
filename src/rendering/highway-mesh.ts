import { BufferAttribute, BufferGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import {
  HIGHWAY_COLOR,
  HIGHWAY_DASH_GAP,
  HIGHWAY_DASH_LENGTH,
  HIGHWAY_LINE_COLOR,
  HIGHWAY_LINE_WIDTH,
  HIGHWAY_LINE_Y,
  HIGHWAY_OFFMAP_CELLS,
  HIGHWAY_RAMP_HALF_WIDTH,
  HIGHWAY_SURFACE_Y,
} from './constants';

/** Accumulates flat, upward-facing quads (arbitrary corners) into one geometry. */
class FlatQuads {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];

  /**
   * One up-facing quad from its four corners at height y. Left/right edges may
   * differ between the near (z0) and far (z1) rows, so trapezoids work. Corner
   * order and winding mirror the road-mesh quad (normal +y).
   */
  deck(
    leftZ0: number,
    rightZ0: number,
    z0: number,
    leftZ1: number,
    rightZ1: number,
    z1: number,
    y: number,
  ): void {
    const base = this.positions.length / 3;
    this.positions.push(leftZ0, y, z0, rightZ0, y, z0, leftZ1, y, z1, rightZ1, y, z1);
    for (let i = 0; i < 4; i++) this.normals.push(0, 1, 0);
    this.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setIndex(new BufferAttribute(new Uint32Array(this.indices), 1));
    return geometry;
  }
}

/**
 * The fixed outside-highway visual: a straight dark ribbon over the seeded
 * highway cells (matching the 1-cell road width so player roads meet it
 * cleanly) that fans into a wider ramp beyond the north map edge, plus a dashed
 * amber center line down the whole length. Static geometry, built once — the
 * highway never moves or changes. Geometry is expressed directly in world
 * coordinates (cell (x,y) → x∈[x,x+1], z∈[y,y+1]); it assumes the constant's
 * north-edge vertical stub.
 */
export class HighwayView {
  readonly group: Group;

  constructor(opts: { column: number; length: number }) {
    const { column, length } = opts;
    const centerX = column + 0.5;
    const rampHalf = HIGHWAY_RAMP_HALF_WIDTH;
    const offZ = -HIGHWAY_OFFMAP_CELLS;

    const asphalt = new FlatQuads();
    // On-map ribbon: 1 cell wide, from the edge (z=0) inward to z=length.
    asphalt.deck(column, column + 1, 0, column, column + 1, length, HIGHWAY_SURFACE_Y);
    // Off-map ramp: fans from the 1-cell mouth at z=0 out to the wide far end.
    asphalt.deck(
      centerX - rampHalf,
      centerX + rampHalf,
      offZ,
      column,
      column + 1,
      0,
      HIGHWAY_SURFACE_Y,
    );

    const lines = new FlatQuads();
    const half = HIGHWAY_LINE_WIDTH / 2;
    const step = HIGHWAY_DASH_LENGTH + HIGHWAY_DASH_GAP;
    for (let z = offZ; z < length; z += step) {
      const z1 = Math.min(z + HIGHWAY_DASH_LENGTH, length);
      lines.deck(centerX - half, centerX + half, z, centerX - half, centerX + half, z1, HIGHWAY_LINE_Y);
    }

    this.group = new Group();
    this.group.name = 'highway';
    // polygonOffset biases the line toward the camera so it never z-fights the
    // asphalt directly beneath it, even at the far zoom cap.
    const lineMaterial = new MeshLambertMaterial({ color: HIGHWAY_LINE_COLOR });
    lineMaterial.polygonOffset = true;
    lineMaterial.polygonOffsetFactor = -1;
    lineMaterial.polygonOffsetUnits = -1;
    this.group.add(
      new Mesh(asphalt.build(), new MeshLambertMaterial({ color: HIGHWAY_COLOR })),
      new Mesh(lines.build(), lineMaterial),
    );
  }
}
