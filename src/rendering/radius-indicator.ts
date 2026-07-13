import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { RADIUS_FILL_COLOR, RADIUS_FILL_OPACITY, RADIUS_LINE_COLOR, RADIUS_Y } from './constants';
import { writeSurfaceQuad } from './surface-geometry';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

/**
 * Effect-area preview shown while a click-place tool hovers: a translucent
 * square (coverage/bridge metrics are Chebyshev, so the true region IS a
 * square) with a bright border.
 */
export class RadiusIndicator {
  readonly group = new Group();
  private readonly fill: Mesh;
  private readonly border: Line;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
  private lastBounds: readonly [number, number, number, number] | null = null;

  constructor() {
    this.fill = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        color: RADIUS_FILL_COLOR,
        transparent: true,
        opacity: RADIUS_FILL_OPACITY,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.fill.name = 'radius-fill';
    this.border = new Line(
      new BufferGeometry(),
      new LineBasicMaterial({ color: RADIUS_LINE_COLOR, transparent: true, opacity: 0.8 }),
    );
    this.border.name = 'radius-border';

    this.group.add(this.fill, this.border);
    this.group.visible = false;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    this.lastBounds = null;
  }

  /** Shows the inclusive cell box [minX..maxX] x [minY..maxY]. */
  show(minX: number, minY: number, maxX: number, maxY: number): void {
    const previous = this.lastBounds;
    if (
      previous &&
      previous[0] === minX &&
      previous[1] === minY &&
      previous[2] === maxX &&
      previous[3] === maxY
    ) {
      this.group.visible = true;
      return;
    }
    this.lastBounds = [minX, minY, maxX, maxY];
    const width = maxX - minX + 1;
    const depth = maxY - minY + 1;
    const positions = new Float32Array(width * depth * 12);
    const indices = new Uint32Array(width * depth * 6);
    let cell = 0;
    for (let z = minY; z <= maxY; z++) {
      for (let x = minX; x <= maxX; x++) {
        writeSurfaceQuad(positions, cell * 12, this.surface, x, z, x + 1, z + 1, RADIUS_Y);
        const base = cell * 4;
        indices.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], cell * 6);
        cell++;
      }
    }
    const fillGeometry = new BufferGeometry();
    fillGeometry.setAttribute('position', new BufferAttribute(positions, 3));
    fillGeometry.setIndex(new BufferAttribute(indices, 1));
    const oldFill = this.fill.geometry;
    this.fill.geometry = fillGeometry;
    oldFill.dispose();

    const borderPoints: number[] = [];
    const addPoint = (x: number, z: number): void => {
      borderPoints.push(x, this.surface.heightAt(x, z) + RADIUS_Y + 0.002, z);
    };
    for (let x = minX; x <= maxX + 1; x++) addPoint(x, minY);
    for (let z = minY + 1; z <= maxY + 1; z++) addPoint(maxX + 1, z);
    for (let x = maxX; x >= minX; x--) addPoint(x, maxY + 1);
    for (let z = maxY; z >= minY; z--) addPoint(minX, z);
    const borderGeometry = new BufferGeometry();
    borderGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(borderPoints), 3),
    );
    const oldBorder = this.border.geometry;
    this.border.geometry = borderGeometry;
    oldBorder.dispose();
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }
}
