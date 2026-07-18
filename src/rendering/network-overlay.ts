import {
  DataTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';
import { NETWORK_OVERLAY_Y } from './constants';
import { OVERLAY_STATUS_RGBA, type OverlayStatus } from './overlay-semantics';
import { buildDrapedPlaneGeometry } from './surface-geometry';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

export interface NetworkOverlayData {
  /** Infrastructure cells (plants+lines / pumps+pipes) — the brightest green. */
  infrastructure: ReadonlySet<number>;
  /** Cells within connection reach of the network — the faintest green halo. */
  reach: ReadonlySet<number>;
  /** Footprint cells of supplied buildings — mid green. */
  supplied: ReadonlySet<number>;
  /** Live buildings missing the utility but still coping — yellow. */
  warn: ReadonlySet<number>;
  /** Buildings near abandonment over it, or already abandoned — red. */
  severe: ReadonlySet<number>;
}

/**
 * Client-computed utility overlay: shows the conduction network, its
 * connection reach, supplied buildings, and unsupplied buildings in red.
 */
export class NetworkOverlayView {
  readonly mesh: Mesh;
  private readonly texture: DataTexture;
  private readonly data: Uint8Array;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor(
    private readonly gridWidth: number,
    private readonly gridHeight: number,
  ) {
    this.data = new Uint8Array(gridWidth * gridHeight * 4);
    this.texture = new DataTexture(this.data, gridWidth, gridHeight, RGBAFormat);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.flipY = false;
    // Colors are authored as sRGB (like the field overlay's ramp texture);
    // without the tag they render linear → washed out.
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      buildDrapedPlaneGeometry(gridWidth, gridHeight, this.surface, NETWORK_OVERLAY_Y, 0),
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        // Overlays are information, not world: distance haze must not wash them.
        fog: false,
      }),
    );
    // The draped geometry flips V so DataTexture row 0 lands at world z=0.
    this.mesh.position.set(gridWidth / 2, 0, gridHeight / 2);
    this.mesh.visible = false;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    const old = this.mesh.geometry;
    this.mesh.geometry = buildDrapedPlaneGeometry(
      this.gridWidth,
      this.gridHeight,
      surface,
      NETWORK_OVERLAY_Y,
      0,
    );
    old.dispose();
  }

  /**
   * Paints least-to-most urgent, so an escalation always wins the cell: the
   * reach halo yields to a served building, which yields to the infrastructure
   * itself, which yields to a warning, which yields to a failure.
   */
  update(overlay: NetworkOverlayData): void {
    this.data.fill(0);
    const paint = (cells: Iterable<number>, status: OverlayStatus) => {
      const [r, g, b, a] = OVERLAY_STATUS_RGBA[status];
      for (const cell of cells) {
        const o = cell * 4;
        this.data[o] = r;
        this.data[o + 1] = g;
        this.data[o + 2] = b;
        this.data[o + 3] = a;
      }
    };
    paint(overlay.reach, 'reach');
    paint(overlay.supplied, 'provided');
    paint(overlay.infrastructure, 'source');
    paint(overlay.warn, 'warn');
    paint(overlay.severe, 'severe');
    this.texture.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
