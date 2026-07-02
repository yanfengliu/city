import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { RADIUS_FILL_COLOR, RADIUS_FILL_OPACITY, RADIUS_LINE_COLOR, RADIUS_Y } from './constants';

/**
 * Effect-area preview shown while a click-place tool hovers: a translucent
 * square (coverage/bridge metrics are Chebyshev, so the true region IS a
 * square) with a bright border.
 */
export class RadiusIndicator {
  readonly group = new Group();
  private readonly fill: Mesh;
  private readonly border: Line;

  constructor() {
    this.fill = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        color: RADIUS_FILL_COLOR,
        transparent: true,
        opacity: RADIUS_FILL_OPACITY,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.fill.rotation.x = -Math.PI / 2;

    const borderGeometry = new BufferGeometry();
    // Unit square loop in the XZ plane, centered at origin; scaled per show().
    borderGeometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          -0.5, 0, -0.5,
          0.5, 0, -0.5,
          0.5, 0, 0.5,
          -0.5, 0, 0.5,
          -0.5, 0, -0.5,
        ]),
        3,
      ),
    );
    this.border = new Line(
      borderGeometry,
      new LineBasicMaterial({ color: RADIUS_LINE_COLOR, transparent: true, opacity: 0.8 }),
    );

    this.group.add(this.fill, this.border);
    this.group.visible = false;
  }

  /** Shows the inclusive cell box [minX..maxX] x [minY..maxY]. */
  show(minX: number, minY: number, maxX: number, maxY: number): void {
    const width = maxX - minX + 1;
    const depth = maxY - minY + 1;
    const centerX = minX + width / 2;
    const centerZ = minY + depth / 2;
    this.fill.position.set(centerX, RADIUS_Y, centerZ);
    this.fill.scale.set(width, depth, 1);
    this.border.position.set(centerX, RADIUS_Y + 0.002, centerZ);
    this.border.scale.set(width, 1, depth);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }
}
