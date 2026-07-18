import { BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from 'three';
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
import { GeometryBuilder } from './geometry-builder';
import {
  SIDEWALK_COLOR,
} from './road-streetscape-style';
import {
  addSidewalks,
  addTrafficSignals,
  type RoadNeighbors,
  type SignalLensDescriptor,
} from './road-streetscape';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

function roadDetailColor(index: number): Color {
  return new Color(ROAD_DETAIL_COLOR).offsetHSL(
    0,
    0,
    (cellHash01(index) - 0.5) * ROAD_DETAIL_LIGHTNESS_JITTER,
  );
}

/**
 * Road cells as merged asphalt-surface quads with a subtle worn detail strip
 * plus crisp lane markings, sidewalks, and junction signal fixtures,
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
  private readonly sidewalkMesh: Mesh;
  private readonly trafficSignalMesh: Mesh;
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
  /** Number of terrain-draped sidewalk patches in the current road projection. */
  sidewalkPatchCount = 0;
  /** Land-road cells with at least three connected approaches. */
  signalizedIntersectionCount = 0;
  /** One traffic-light assembly per connected approach at a signalized junction. */
  trafficSignalAssemblyCount = 0;
  /** Live lens layout from the last rebuild (consumed by SignalLensesView). */
  signalLensDescriptors: readonly SignalLensDescriptor[] = [];
  /** Invoked after every rebuild with the fresh lens layout. */
  onSignalLenses: ((lenses: readonly SignalLensDescriptor[]) => void) | null = null;

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
    this.sidewalkMesh = new Mesh(
      new BufferGeometry(),
      new MeshLambertMaterial({ color: SIDEWALK_COLOR }),
    );
    this.sidewalkMesh.name = 'road-sidewalks';
    this.trafficSignalMesh = new Mesh(
      new BufferGeometry(),
      new MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
    );
    this.trafficSignalMesh.name = 'road-traffic-signals';
    this.bridgeMesh = new Mesh(
      new BufferGeometry(),
      new MeshLambertMaterial({ color: BRIDGE_COLOR }),
    );
    this.bridgeMesh.name = 'bridge-surface';
    this.roadMesh.visible = false;
    this.roadDetailMesh.visible = false;
    this.roadLaneMesh.visible = false;
    this.sidewalkMesh.visible = false;
    this.trafficSignalMesh.visible = false;
    this.bridgeMesh.visible = false;
    this.roadMesh.receiveShadow = true;
    this.roadDetailMesh.receiveShadow = true;
    this.roadLaneMesh.receiveShadow = true;
    this.sidewalkMesh.receiveShadow = true;
    this.trafficSignalMesh.castShadow = false;
    this.trafficSignalMesh.receiveShadow = false;
    this.bridgeMesh.castShadow = true;
    this.bridgeMesh.receiveShadow = true;
    this.group = new Group();
    this.group.name = 'roads';
    this.group.add(
      this.roadMesh,
      this.roadDetailMesh,
      this.roadLaneMesh,
      this.sidewalkMesh,
      this.trafficSignalMesh,
      this.bridgeMesh,
    );
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
    const sidewalks = new GeometryBuilder();
    const trafficSignals = new GeometryBuilder();
    const lenses: SignalLensDescriptor[] = [];
    this.sidewalkPatchCount = 0;
    this.signalizedIntersectionCount = 0;
    this.trafficSignalAssemblyCount = 0;
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
      const neighbors = this.neighbors(roadCellSet, index, x, z);
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
      this.addLaneMarking(roadLanes, neighbors, x, z);
      this.sidewalkPatchCount += addSidewalks(sidewalks, this.surface, neighbors, x, z);
      const signalAssemblies = addTrafficSignals(
        trafficSignals,
        this.surface,
        neighbors,
        index,
        x,
        z,
        lenses,
      );
      if (signalAssemblies > 0) this.signalizedIntersectionCount++;
      this.trafficSignalAssemblyCount += signalAssemblies;
      landRoadCount++;
    }
    this.bridgeCellCount = bridges.length;
    this.swapGeometry(this.roadMesh, roads.build(), landRoadCount > 0);
    this.swapGeometry(this.roadDetailMesh, roadDetails.build(), landRoadCount > 0);
    this.swapGeometry(this.roadLaneMesh, roadLanes.build(), landRoadCount > 0);
    this.swapGeometry(this.sidewalkMesh, sidewalks.build(), this.sidewalkPatchCount > 0);
    this.swapGeometry(
      this.trafficSignalMesh,
      trafficSignals.build(),
      this.trafficSignalAssemblyCount > 0,
    );
    this.swapGeometry(this.bridgeMesh, this.buildBridges(bridges, roadCellSet), bridges.length > 0);
    this.signalLensDescriptors = lenses;
    this.onSignalLenses?.(lenses);
  }

  private neighbors(
    roadCells: ReadonlySet<number>,
    index: number,
    x: number,
    z: number,
  ): RoadNeighbors {
    const w = this.gridWidth;
    return {
      w: x > 0 && roadCells.has(index - 1),
      e: x < w - 1 && roadCells.has(index + 1),
      n: z > 0 && roadCells.has(index - w),
      s: z < w - 1 && roadCells.has(index + w),
    };
  }

  private addLaneMarking(
    b: GeometryBuilder,
    neighbors: RoadNeighbors,
    x: number,
    z: number,
  ): void {
    const horizontal = neighbors.w || neighbors.e;
    const vertical = neighbors.n || neighbors.s || !horizontal;
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
