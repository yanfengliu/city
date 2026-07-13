import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
import {
  BRIDGE_COLOR,
  BRIDGE_PYLON_BOTTOM_Y,
  BRIDGE_PYLON_HALF_WIDTH,
  BRIDGE_RAIL_HEIGHT,
  BRIDGE_RAIL_THICKNESS,
  cellHash01,
  ROAD_COLOR,
  ROAD_DETAIL_COLOR,
  ROAD_DETAIL_END_INSET,
  ROAD_DETAIL_LIGHTNESS_JITTER,
  ROAD_DETAIL_SIDE_INSET,
  ROAD_DETAIL_Y,
  ROAD_LANE_MARKING_COLOR,
  ROAD_LANE_MARKING_LENGTH,
  ROAD_LANE_MARKING_WIDTH,
  ROAD_LANE_MARKING_Y,
  ROAD_SURFACE_Y,
} from './constants';
import { buildSurfacePatch } from './surface-geometry';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

/** Accumulates merged quads/boxes into one BufferGeometry. */
class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  private corners(
    points: ReadonlyArray<readonly [number, number, number]>,
    normal: readonly [number, number, number] = [0, 1, 0],
  ): void {
    const base = this.positions.length / 3;
    for (const point of points) this.positions.push(point[0], point[1], point[2]);
    for (let i = 0; i < 4; i++) this.normals.push(normal[0], normal[1], normal[2]);
    this.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  /** One rectangular face: origin o plus edge vectors u and v, flat normal n. */
  private face(
    o: readonly [number, number, number],
    u: readonly [number, number, number],
    v: readonly [number, number, number],
    n: readonly [number, number, number],
  ): void {
    this.corners([
      o,
      [o[0] + u[0], o[1] + u[1], o[2] + u[2]],
      [o[0] + v[0], o[1] + v[1], o[2] + v[2]],
      [o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2]],
    ], n);
  }

  /** Upward-facing quad covering [x0,x1]×[z0,z1] at height y. */
  quad(x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.face([x0, y, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0], [0, 1, 0]);
  }

  surfaceQuad(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    lift: number,
    surface: TerrainSurfaceView,
  ): void {
    this.corners([
      [x0, surface.heightAt(x0, z0) + lift, z0],
      [x1, surface.heightAt(x1, z0) + lift, z0],
      [x0, surface.heightAt(x0, z1) + lift, z1],
      [x1, surface.heightAt(x1, z1) + lift, z1],
    ]);
  }

  surfacePatch(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    lift: number,
    surface: TerrainSurfaceView,
  ): number {
    const patch = buildSurfacePatch(surface, x0, z0, x1, z1, lift);
    const base = this.positions.length / 3;
    this.positions.push(...patch.positions);
    const count = patch.positions.length / 3;
    for (let i = 0; i < count; i++) this.normals.push(0, 1, 0);
    for (const index of patch.indices) this.indices.push(base + index);
    return count;
  }

  /** Upward-facing quad with a per-vertex color for one merged detail layer. */
  coloredQuad(x0: number, z0: number, x1: number, z1: number, y: number, color: Color): void {
    this.quad(x0, z0, x1, z1, y);
    for (let i = 0; i < 4; i++) this.colors.push(color.r, color.g, color.b);
  }

  coloredSurfacePatch(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    lift: number,
    surface: TerrainSurfaceView,
    color: Color,
  ): void {
    const count = this.surfacePatch(x0, z0, x1, z1, lift, surface);
    for (let i = 0; i < count; i++) this.colors.push(color.r, color.g, color.b);
  }

  /** Axis-aligned box between opposite corners (all six faces). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    this.face([x0, y1, z0], [dx, 0, 0], [0, 0, dz], [0, 1, 0]); // top
    this.face([x0, y0, z0], [0, 0, dz], [dx, 0, 0], [0, -1, 0]); // bottom
    this.face([x1, y0, z0], [0, 0, dz], [0, dy, 0], [1, 0, 0]); // +x
    this.face([x0, y0, z0], [0, dy, 0], [0, 0, dz], [-1, 0, 0]); // -x
    this.face([x0, y0, z1], [0, dy, 0], [dx, 0, 0], [0, 0, 1]); // +z
    this.face([x0, y0, z0], [dx, 0, 0], [0, dy, 0], [0, 0, -1]); // -z
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    if (this.colors.length > 0) {
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    }
    geometry.setIndex(new BufferAttribute(new Uint32Array(this.indices), 1));
    geometry.computeVertexNormals();
    return geometry;
  }
}

function roadDetailColor(index: number): Color {
  return new Color(ROAD_DETAIL_COLOR).offsetHSL(
    0,
    0,
    (cellHash01(index) - 0.5) * ROAD_DETAIL_LIGHTNESS_JITTER,
  );
}

/**
 * Road cells as merged asphalt-surface quads with a subtle worn detail strip
 * plus crisp lane markings for strategy-zoom road readability,
 * plus a concrete bridge mesh for road cells over water (causeway deck at road
 * height, railings on edges without a road neighbor, pylons down into the
 * water). Fully rebuilt from each `roads` message — cheap at current scale
 * (chunked rebuilds come later).
 */
export class RoadsView {
  readonly group: Group;
  private readonly roadMesh: Mesh;
  private readonly roadDetailMesh: Mesh;
  private readonly roadLaneMesh: Mesh;
  private readonly bridgeMesh: Mesh;
  private readonly gridWidth: number;
  /** Highway cells rendered by HighwayView — skipped here to avoid double-draw. */
  private readonly highwayCells: ReadonlySet<number>;
  /** Terrain water mask; null until boot's `ready` message delivers it. */
  private water: Uint8Array | null = null;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
  private lastCells: readonly number[] = [];
  /** Road cell count from the last update, for automation/text state. */
  cellCount = 0;
  /** How many of those cells are bridges (road over water). */
  bridgeCellCount = 0;

  constructor(gridWidth: number, highwayCells: ReadonlySet<number> = new Set()) {
    this.gridWidth = gridWidth;
    this.highwayCells = highwayCells;
    this.roadMesh = new Mesh(new BufferGeometry(), new MeshLambertMaterial({ color: ROAD_COLOR }));
    this.roadMesh.name = 'road-surface';
    this.roadDetailMesh = new Mesh(
      new BufferGeometry(),
      new MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
    );
    this.roadDetailMesh.name = 'road-surface-details';
    this.roadLaneMesh = new Mesh(
      new BufferGeometry(),
      new MeshLambertMaterial({ color: ROAD_LANE_MARKING_COLOR }),
    );
    this.roadLaneMesh.name = 'road-lane-markings';
    this.bridgeMesh = new Mesh(
      new BufferGeometry(),
      new MeshLambertMaterial({ color: BRIDGE_COLOR }),
    );
    this.bridgeMesh.name = 'bridge-surface';
    this.roadMesh.visible = false;
    this.roadDetailMesh.visible = false;
    this.roadLaneMesh.visible = false;
    this.bridgeMesh.visible = false;
    this.roadMesh.receiveShadow = true;
    this.roadDetailMesh.receiveShadow = true;
    this.roadLaneMesh.receiveShadow = true;
    this.bridgeMesh.castShadow = true;
    this.bridgeMesh.receiveShadow = true;
    this.group = new Group();
    this.group.name = 'roads';
    this.group.add(this.roadMesh, this.roadDetailMesh, this.roadLaneMesh, this.bridgeMesh);
  }

  /** Terrain water mask from boot; re-renders roads that arrived earlier. */
  setWater(water: Uint8Array): void {
    this.water = water;
    if (this.lastCells.length > 0) this.update(this.lastCells);
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    if (this.lastCells.length > 0) this.update(this.lastCells);
  }

  /** Rebuilds the merged geometry from road cell indices (index = y * width + x). */
  update(cells: readonly number[]): void {
    this.lastCells = cells;
    this.cellCount = cells.length;
    const bridges: number[] = [];
    const roadCellSet = new Set(cells);
    const roads = new GeometryBuilder();
    const roadDetails = new GeometryBuilder();
    const roadLanes = new GeometryBuilder();
    let landRoadCount = 0;
    for (const index of cells) {
      // Highway cells are drawn distinctly by HighwayView.
      if (this.highwayCells.has(index)) continue;
      if (this.water && this.water[index] === 1) {
        bridges.push(index);
        continue;
      }
      const x = index % this.gridWidth;
      const z = Math.floor(index / this.gridWidth);
      roads.surfaceQuad(x, z, x + 1, z + 1, ROAD_SURFACE_Y, this.surface);
      roadDetails.coloredSurfacePatch(
        x + ROAD_DETAIL_SIDE_INSET,
        z + ROAD_DETAIL_END_INSET,
        x + 1 - ROAD_DETAIL_SIDE_INSET,
        z + 1 - ROAD_DETAIL_END_INSET,
        ROAD_DETAIL_Y,
        this.surface,
        roadDetailColor(index),
      );
      this.addLaneMarking(roadLanes, roadCellSet, index, x, z);
      landRoadCount++;
    }
    this.bridgeCellCount = bridges.length;
    this.swapGeometry(this.roadMesh, roads.build(), landRoadCount > 0);
    this.swapGeometry(this.roadDetailMesh, roadDetails.build(), landRoadCount > 0);
    this.swapGeometry(this.roadLaneMesh, roadLanes.build(), landRoadCount > 0);
    this.swapGeometry(this.bridgeMesh, this.buildBridges(bridges, roadCellSet), bridges.length > 0);
  }

  private addLaneMarking(
    b: GeometryBuilder,
    roadCells: ReadonlySet<number>,
    index: number,
    x: number,
    z: number,
  ): void {
    const w = this.gridWidth;
    const hasW = x > 0 && roadCells.has(index - 1);
    const hasE = x < w - 1 && roadCells.has(index + 1);
    const hasN = z > 0 && roadCells.has(index - w);
    const hasS = z < w - 1 && roadCells.has(index + w);
    const horizontal = hasW || hasE;
    const vertical = hasN || hasS || !horizontal;
    const halfWidth = ROAD_LANE_MARKING_WIDTH / 2;
    const halfLength = ROAD_LANE_MARKING_LENGTH / 2;
    const cx = x + 0.5;
    const cz = z + 0.5;
    if (vertical) {
      b.surfacePatch(
        cx - halfWidth,
        cz - halfLength,
        cx + halfWidth,
        cz + halfLength,
        ROAD_LANE_MARKING_Y,
        this.surface,
      );
    }
    if (horizontal) {
      b.surfacePatch(
        cx - halfLength,
        cz - halfWidth,
        cx + halfLength,
        cz + halfWidth,
        ROAD_LANE_MARKING_Y,
        this.surface,
      );
    }
  }

  private buildBridges(bridges: readonly number[], roadCells: ReadonlySet<number>): BufferGeometry {
    const b = new GeometryBuilder();
    const w = this.gridWidth;
    const deckY = ROAD_SURFACE_Y;
    const railTop = deckY + BRIDGE_RAIL_HEIGHT;
    const t = BRIDGE_RAIL_THICKNESS;
    for (const index of bridges) {
      const x = index % w;
      const z = Math.floor(index / w);
      b.quad(x, z, x + 1, z + 1, deckY);
      const cx = x + 0.5;
      const cz = z + 0.5;
      const half = BRIDGE_PYLON_HALF_WIDTH;
      b.box(cx - half, BRIDGE_PYLON_BOTTOM_Y, cz - half, cx + half, deckY, cz + half);
      // Railings on edges without a road/bridge continuation. East/west rails
      // run the full cell; north/south rails trim where an east/west rail
      // already fills the corner.
      const railW = x === 0 || !roadCells.has(index - 1);
      const railE = x === w - 1 || !roadCells.has(index + 1);
      const railN = !roadCells.has(index - w);
      const railS = !roadCells.has(index + w);
      if (railW) b.box(x, deckY, z, x + t, railTop, z + 1);
      if (railE) b.box(x + 1 - t, deckY, z, x + 1, railTop, z + 1);
      const x0 = x + (railW ? t : 0);
      const x1 = x + 1 - (railE ? t : 0);
      if (railN) b.box(x0, deckY, z, x1, railTop, z + t);
      if (railS) b.box(x0, deckY, z + 1 - t, x1, railTop, z + 1);
    }
    return b.build();
  }

  private swapGeometry(mesh: Mesh, geometry: BufferGeometry, visible: boolean): void {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old.dispose();
    mesh.visible = visible;
  }
}
