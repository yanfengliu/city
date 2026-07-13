import {
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Quaternion } from 'three';
import {
  BUILDING_LEVEL_HEIGHTS,
  BUILDING_ROOF_HEIGHTS,
  UTILITY_ICON_BOUNCE,
  UTILITY_ICON_SCALE,
  UTILITY_ICON_Y_GAP,
  type ZoneKind,
} from './constants';
import {
  drawUtilityIconBadges,
  utilityIconBadgeLayout,
  utilityIconBadgeParts,
} from './utility-icon-badge';
import { utilityIconKey, type UtilityIconView } from './utility-icon-key';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

/** What the fx needs from a building view to place its problem icon. */
export interface IconBuildingView extends UtilityIconView {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  zone: ZoneKind;
  level: number;
}

interface IconEntry {
  key: string;
  x: number;
  z: number;
  baseY: number;
  /** Per-building bob offset so a district doesn't pulse in unison. */
  phase: number;
}

interface IconBatch {
  mesh: InstancedMesh<PlaneGeometry, MeshBasicMaterial>;
  material: MeshBasicMaterial;
  ids: Set<number>;
  capacity: number;
}

const INITIAL_BATCH_CAPACITY = 64;

function warningRenderOrder(key: string): number {
  const parts = utilityIconBadgeParts(key);
  if (parts.length > 1) return 5;
  return parts[0]?.kind === 'water' ? 4 : 3;
}

/** Draws compact vector badge(s) onto a canvas texture (cached per key). */
function makeTexture(key: string): CanvasTexture {
  const layout = utilityIconBadgeLayout(key);
  const canvas = document.createElement('canvas');
  canvas.height = layout.canvasHeight;
  canvas.width = layout.canvasWidth;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    drawUtilityIconBadges(ctx, key);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Floating ⚡/💧 icons over LIVE buildings that lack power/water — an at-a-glance
 * "fix me before I abandon" warning, always on (no overlay needed). Reconciled
 * per building upsert (the flood-fill re-upserts only buildings whose flags
 * changed) and per removal; a gentle bob is applied each frame. Textures are
 * cached per icon key, while all buildings sharing a key render in one
 * instanced billboard batch (at most three warning draw calls).
 */
export class UtilityIconsFx {
  readonly group = new Group();
  private readonly entries = new Map<number, IconEntry>();
  private readonly textures = new Map<string, CanvasTexture>();
  private readonly batches = new Map<string, IconBatch>();
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchPosition = new Vector3();
  private readonly scratchScale = new Vector3();
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;

  constructor() {
    this.group.name = 'utilityIcons';
  }

  /** Live count of shown icons (for the automation text state). */
  get count(): number {
    return this.entries.size;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
  }

  private texture(key: string): CanvasTexture {
    let cached = this.textures.get(key);
    if (!cached) {
      cached = makeTexture(key);
      this.textures.set(key, cached);
    }
    return cached;
  }

  private makeMesh(key: string, material: MeshBasicMaterial, capacity: number): InstancedMesh<PlaneGeometry, MeshBasicMaterial> {
    const mesh = new InstancedMesh(this.geometry, material, capacity);
    mesh.name = `utility-icons-${key}`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    // Explicit cross-batch priority avoids creation-order-dependent overlap:
    // combined warnings win, then water, then power.
    mesh.renderOrder = warningRenderOrder(key);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    return mesh;
  }

  private batch(key: string): IconBatch {
    let batch = this.batches.get(key);
    if (batch) return batch;
    const material = new MeshBasicMaterial({
      map: this.texture(key),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    batch = {
      mesh: this.makeMesh(key, material, INITIAL_BATCH_CAPACITY),
      material,
      ids: new Set(),
      capacity: INITIAL_BATCH_CAPACITY,
    };
    this.batches.set(key, batch);
    this.group.add(batch.mesh);
    return batch;
  }

  private ensureCapacity(key: string, batch: IconBatch): void {
    if (batch.ids.size <= batch.capacity) return;
    let capacity = batch.capacity;
    while (capacity < batch.ids.size) capacity *= 2;
    const replacement = this.makeMesh(key, batch.material, capacity);
    this.group.remove(batch.mesh);
    batch.mesh.dispose();
    batch.mesh = replacement;
    batch.capacity = capacity;
    this.group.add(replacement);
  }

  /** Add/update/remove the icon for one building. */
  sync(view: IconBuildingView): void {
    const key = utilityIconKey(view);
    const existing = this.entries.get(view.id);
    if (!key) {
      if (existing) this.disposeEntry(view.id, existing);
      return;
    }
    const cx = view.x + view.w / 2;
    const cz = view.y + view.h / 2;
    const levelIdx = Math.min(Math.max(view.level, 1), BUILDING_LEVEL_HEIGHTS.length) - 1;
    const baseY =
      this.surface.footprintRange(view.x, view.y, view.w, view.h).max +
      BUILDING_LEVEL_HEIGHTS[levelIdx] +
      BUILDING_ROOF_HEIGHTS[view.zone] +
      UTILITY_ICON_Y_GAP;
    if (existing) {
      existing.x = cx;
      existing.z = cz;
      existing.baseY = baseY;
      if (existing.key !== key) {
        this.batches.get(existing.key)?.ids.delete(view.id);
        existing.key = key;
        this.batch(key).ids.add(view.id);
      }
      return;
    }
    this.entries.set(view.id, {
      key,
      x: cx,
      z: cz,
      baseY,
      phase: ((view.id % 12) / 12) * Math.PI * 2,
    });
    this.batch(key).ids.add(view.id);
  }

  /** Drop a building's icon (on removal). Tolerates unknown ids. */
  remove(id: number): void {
    const entry = this.entries.get(id);
    if (entry) this.disposeEntry(id, entry);
  }

  private disposeEntry(id: number, entry: IconEntry): void {
    this.batches.get(entry.key)?.ids.delete(id);
    this.entries.delete(id);
  }

  /** Gentle vertical bob + camera-facing instance transforms; call once per frame. */
  updateFrame(nowMs: number, cameraQuaternion: Quaternion): void {
    for (const [key, batch] of this.batches) {
      this.ensureCapacity(key, batch);
      let slot = 0;
      const width = utilityIconBadgeLayout(key).spriteWidth;
      for (const id of batch.ids) {
        const entry = this.entries.get(id);
        if (!entry || entry.key !== key) continue;
        this.scratchPosition.set(
          entry.x,
          entry.baseY + Math.sin(nowMs / 300 + entry.phase) * UTILITY_ICON_BOUNCE,
          entry.z,
        );
        this.scratchScale.set(UTILITY_ICON_SCALE * width, UTILITY_ICON_SCALE, 1);
        this.scratchMatrix.compose(
          this.scratchPosition,
          cameraQuaternion,
          this.scratchScale,
        );
        batch.mesh.setMatrixAt(slot, this.scratchMatrix);
        slot++;
      }
      batch.mesh.count = slot;
      if (slot > 0) batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
