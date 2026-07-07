import { CanvasTexture, Group, Sprite, SpriteMaterial } from 'three';
import {
  BUILDING_LEVEL_HEIGHTS,
  BUILDING_ROOF_HEIGHTS,
  UTILITY_ICON_BOUNCE,
  UTILITY_ICON_SCALE,
  UTILITY_ICON_Y_GAP,
  type ZoneKind,
} from './constants';
import { drawUtilityIconBadges, utilityIconBadgeLayout } from './utility-icon-badge';
import { utilityIconKey, type UtilityIconView } from './utility-icon-key';

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
  sprite: Sprite;
  material: SpriteMaterial;
  key: string;
  baseY: number;
  /** Per-building bob offset so a district doesn't pulse in unison. */
  phase: number;
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
  return new CanvasTexture(canvas);
}

/**
 * Floating ⚡/💧 icons over LIVE buildings that lack power/water — an at-a-glance
 * "fix me before I abandon" warning, always on (no overlay needed). Reconciled
 * per building upsert (the flood-fill re-upserts only buildings whose flags
 * changed) and per removal; a gentle bob is applied each frame. Textures are
 * cached and shared per icon key; sprites auto-billboard.
 */
export class UtilityIconsFx {
  readonly group = new Group();
  private readonly entries = new Map<number, IconEntry>();
  private readonly textures = new Map<string, CanvasTexture>();

  constructor() {
    this.group.name = 'utilityIcons';
  }

  /** Live count of shown icons (for the automation text state). */
  get count(): number {
    return this.entries.size;
  }

  private texture(key: string): CanvasTexture {
    let cached = this.textures.get(key);
    if (!cached) {
      cached = makeTexture(key);
      this.textures.set(key, cached);
    }
    return cached;
  }

  private applyScale(sprite: Sprite, key: string): void {
    sprite.scale.set(UTILITY_ICON_SCALE * utilityIconBadgeLayout(key).spriteWidth, UTILITY_ICON_SCALE, 1);
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
    const baseY = BUILDING_LEVEL_HEIGHTS[levelIdx] + BUILDING_ROOF_HEIGHTS[view.zone] + UTILITY_ICON_Y_GAP;
    if (existing) {
      existing.baseY = baseY;
      existing.sprite.position.set(cx, baseY, cz);
      if (existing.key !== key) {
        existing.material.map = this.texture(key);
        existing.material.needsUpdate = true;
        existing.key = key;
        this.applyScale(existing.sprite, key);
      }
      return;
    }
    const material = new SpriteMaterial({ map: this.texture(key), transparent: true, depthTest: false });
    const sprite = new Sprite(material);
    this.applyScale(sprite, key);
    sprite.position.set(cx, baseY, cz);
    // depthTest off would draw over everything; keep a high renderOrder but let
    // it still sit behind the HUD (HUD is DOM). renderOrder groups it late.
    sprite.renderOrder = 3;
    this.group.add(sprite);
    this.entries.set(view.id, {
      sprite,
      material,
      key,
      baseY,
      phase: ((view.id % 12) / 12) * Math.PI * 2,
    });
  }

  /** Drop a building's icon (on removal). Tolerates unknown ids. */
  remove(id: number): void {
    const entry = this.entries.get(id);
    if (entry) this.disposeEntry(id, entry);
  }

  private disposeEntry(id: number, entry: IconEntry): void {
    this.group.remove(entry.sprite);
    entry.material.dispose();
    this.entries.delete(id);
  }

  /** Gentle vertical bob; call once per rendered frame. */
  updateFrame(nowMs: number): void {
    for (const entry of this.entries.values()) {
      entry.sprite.position.y = entry.baseY + Math.sin(nowMs / 300 + entry.phase) * UTILITY_ICON_BOUNCE;
    }
  }
}
