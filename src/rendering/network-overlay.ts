import {
  DataTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
} from 'three';
import { NETWORK_OVERLAY_Y } from './constants';

export interface NetworkOverlayData {
  /** Infrastructure cells (plants+lines / pumps+pipes) — drawn brightest. */
  infrastructure: ReadonlySet<number>;
  /** Cells within connection reach of the network — the "you can build here" halo. */
  reach: ReadonlySet<number>;
  /** Footprint cells of supplied buildings. */
  supplied: ReadonlySet<number>;
  /** Footprint cells of live buildings LACKING the utility — drawn red. */
  problems: ReadonlySet<number>;
}

const COLOR_BY_MODE = {
  power: { infra: [255, 220, 80], supplied: [120, 210, 120] },
  water: { infra: [90, 180, 255], supplied: [120, 200, 220] },
} as const;

/**
 * Client-computed utility overlay: shows the conduction network, its
 * connection reach, supplied buildings, and unsupplied buildings in red.
 */
export class NetworkOverlayView {
  readonly mesh: Mesh;
  private readonly texture: DataTexture;
  private readonly data: Uint8Array;

  constructor(gridWidth: number, gridHeight: number) {
    this.data = new Uint8Array(gridWidth * gridHeight * 4);
    this.texture = new DataTexture(this.data, gridWidth, gridHeight, RGBAFormat);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.flipY = false;
    this.mesh = new Mesh(
      new PlaneGeometry(gridWidth, gridHeight),
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    // PlaneGeometry UV v runs bottom-up; with flipY=false, texel row 0 lands
    // at +z after this rotation — matching cell y = world z directly.
    this.mesh.position.set(gridWidth / 2, NETWORK_OVERLAY_Y, gridHeight / 2);
    this.mesh.scale.y = -1;
    this.mesh.visible = false;
  }

  update(mode: 'power' | 'water', overlay: NetworkOverlayData): void {
    const colors = COLOR_BY_MODE[mode];
    this.data.fill(0);
    const paint = (cell: number, r: number, g: number, b: number, a: number) => {
      const o = cell * 4;
      this.data[o] = r;
      this.data[o + 1] = g;
      this.data[o + 2] = b;
      this.data[o + 3] = a;
    };
    for (const cell of overlay.reach) paint(cell, colors.infra[0], colors.infra[1], colors.infra[2], 45);
    for (const cell of overlay.supplied) paint(cell, colors.supplied[0], colors.supplied[1], colors.supplied[2], 110);
    for (const cell of overlay.infrastructure) paint(cell, colors.infra[0], colors.infra[1], colors.infra[2], 200);
    for (const cell of overlay.problems) paint(cell, 235, 60, 50, 220);
    this.texture.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
