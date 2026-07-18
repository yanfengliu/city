import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';
import {
  FIELD_OVERLAY_VALUE_MAX,
  FIELD_OVERLAY_Y,
  TRAFFIC_BUCKET_COLORS,
  TRAFFIC_OVERLAY_Y,
  type FieldKind,
} from './constants';
import {
  OVERLAY_STATUS_RGBA,
  fieldStatus,
  fieldStatusIntensity,
} from './overlay-semantics';
import { buildDrapedPlaneGeometry, writeSurfaceQuad } from './surface-geometry';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

/** Plain-data field snapshot (mirrors the protocol `field` message). */
export interface FieldOverlayData {
  name: FieldKind;
  /** Layer grid dimensions (each texel covers blockSize x blockSize world cells). */
  width: number;
  height: number;
  defaultValue: number;
  /** Sparse [layerCellIndex, value] pairs; absent cells hold defaultValue. */
  cells: ReadonlyArray<readonly [number, number]>;
}

/**
 * One translucent plane over the terrain showing the active field as a
 * NearestFilter DataTexture (crisp blocks). The texture is reallocated when
 * the layer grid dimensions change (fields have different blockSizes) and
 * refilled on every field message. Hidden until data for the active field
 * arrives; the app layer keeps only one field subscribed at a time.
 */
export class FieldOverlayView {
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private texture: DataTexture | null = null;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor(
    private readonly gridWidth: number,
    private readonly gridHeight: number,
  ) {
    // Per-texel alpha carries the status weight (overlay-semantics.ts), so the
    // material stays at full opacity and lets the shared palette decide what
    // shows and how strongly.
    this.material = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      // Overlays are information, not world: distance haze must not wash them.
      fog: false,
    });
    const geometry = buildDrapedPlaneGeometry(
      gridWidth,
      gridHeight,
      this.surface,
      FIELD_OVERLAY_Y,
      1,
    );
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.position.set(gridWidth / 2, 0, gridHeight / 2);
    this.mesh.name = 'fieldOverlay';
    this.mesh.visible = false;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    const old = this.mesh.geometry;
    this.mesh.geometry = buildDrapedPlaneGeometry(
      this.gridWidth,
      this.gridHeight,
      surface,
      FIELD_OVERLAY_Y,
      1,
    );
    old.dispose();
  }

  /**
   * Fills the texture from a field snapshot and shows the plane. Every cell is
   * graded through the shared status language (overlay-semantics.ts) rather
   * than a per-field colour ramp, so grey/green/yellow/red mean the same thing
   * here as they do on the utility overlays. Alpha ramps within a status band
   * so intensity still reads without inventing a second colour vocabulary.
   */
  setField(data: FieldOverlayData): void {
    const texture = this.ensureTexture(data.width, data.height);
    const values = new Float32Array(data.width * data.height).fill(data.defaultValue);
    for (const [index, value] of data.cells) {
      if (index >= 0 && index < values.length) values[index] = value;
    }
    const pixels = texture.image.data as Uint8ClampedArray;
    for (let y = 0; y < data.height; y++) {
      // Layer row 0 is world z=0, which sits at texture v=1 — flip rows.
      const destRow = data.height - 1 - y;
      for (let x = 0; x < data.width; x++) {
        const value = values[y * data.width + x];
        const mix = Math.min(Math.max(value / FIELD_OVERLAY_VALUE_MAX, 0), 1);
        const [r, g, b, a] = OVERLAY_STATUS_RGBA[fieldStatus(data.name, mix)];
        const offset = (destRow * data.width + x) * 4;
        pixels[offset] = r;
        pixels[offset + 1] = g;
        pixels[offset + 2] = b;
        pixels[offset + 3] = Math.round(a * fieldStatusIntensity(data.name, mix));
      }
    }
    texture.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  private ensureTexture(width: number, height: number): DataTexture {
    if (this.texture && this.texture.image.width === width && this.texture.image.height === height) {
      return this.texture;
    }
    this.texture?.dispose();
    const texture = new DataTexture(new Uint8ClampedArray(width * height * 4), width, height, RGBAFormat);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.colorSpace = SRGBColorSpace;
    this.texture = texture;
    this.material.map = texture;
    this.material.needsUpdate = true;
    return texture;
  }
}

/** Plain-data road edge for the traffic overlay (id + polyline cell indices). */
export interface TrafficEdgeView {
  id: number;
  cells: number[];
}

/**
 * Traffic overlay: when active, every road cell is tinted by its edge's
 * congestion bucket as a merged vertex-colored mesh floating just above the
 * road surface. Shared node cells take the max bucket of their edges. Rebuilt
 * on roads/traffic messages (infrequent) and on activation.
 */
export class TrafficOverlayView {
  readonly mesh: Mesh;
  private edges: readonly TrafficEdgeView[] = [];
  private buckets: ReadonlyMap<number, number> = new Map();
  private active = false;
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor(private readonly gridWidth: number) {
    this.mesh = new Mesh(
      new BufferGeometry(),
      // fog off: congestion colors must read at any camera distance.
      new MeshBasicMaterial({ vertexColors: true, fog: false }),
    );
    this.mesh.name = 'trafficOverlay';
    this.mesh.visible = false;
  }

  setRoads(edges: readonly TrafficEdgeView[]): void {
    this.edges = edges;
    if (this.active) this.rebuild();
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
    if (this.active) this.rebuild();
  }

  setBuckets(buckets: ReadonlyMap<number, number>): void {
    this.buckets = buckets;
    if (this.active) this.rebuild();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.rebuild();
    else this.mesh.visible = false;
  }

  private rebuild(): void {
    // Max bucket per cell (node cells belong to several edges).
    const cellBucket = new Map<number, number>();
    for (const edge of this.edges) {
      const bucket = Math.min(this.buckets.get(edge.id) ?? 0, TRAFFIC_BUCKET_COLORS.length - 1);
      for (const cell of edge.cells) {
        const current = cellBucket.get(cell);
        if (current === undefined || bucket > current) cellBucket.set(cell, bucket);
      }
    }

    const count = cellBucket.size;
    const positions = new Float32Array(count * 12);
    const colors = new Float32Array(count * 12);
    const indices = new Uint32Array(count * 6);
    const color = new Color();
    let i = 0;
    for (const [cell, bucket] of cellBucket) {
      const x = cell % this.gridWidth;
      const z = Math.floor(cell / this.gridWidth);
      writeSurfaceQuad(
        positions,
        i * 12,
        this.surface,
        x,
        z,
        x + 1,
        z + 1,
        TRAFFIC_OVERLAY_Y,
      );
      color.setHex(TRAFFIC_BUCKET_COLORS[bucket]);
      for (let n = 0; n < 4; n++) colors.set([color.r, color.g, color.b], i * 12 + n * 3);
      const base = i * 4;
      indices.set([base, base + 2, base + 1, base + 1, base + 2, base + 3], i * 6);
      i++;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    const old = this.mesh.geometry;
    this.mesh.geometry = geometry;
    old.dispose();
    this.mesh.visible = count > 0;
  }
}
