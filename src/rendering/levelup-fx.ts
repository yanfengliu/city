import {
  CanvasTexture,
  Group,
  Sprite,
  SpriteMaterial,
} from 'three';
import {
  LEVELUP_DURATION_MS,
  LEVELUP_RISE_UNITS,
  LEVELUP_SPRITE_SCALE,
  LEVELUP_START_Y,
} from './constants';

interface FxEntry {
  sprite: Sprite;
  material: SpriteMaterial;
  startMs: number;
  x: number;
  z: number;
}

/** Renders "▲ Level N" text onto a canvas texture (cached per level). */
function makeTexture(level: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(20,40,20,0.9)';
    ctx.fillStyle = '#8fe08f';
    const text = `▲ Level ${level}`;
    ctx.strokeText(text, 128, 48);
    ctx.fillText(text, 128, 48);
  }
  return new CanvasTexture(canvas);
}

/**
 * Floating "▲ Level N" sprites above buildings that just leveled up — the
 * celebration moment. Sprites rise and fade over LEVELUP_DURATION_MS, then
 * their materials are disposed (textures are cached and shared per level).
 */
export class LevelUpFx {
  readonly group = new Group();
  /** Total level-ups celebrated (exposed for the automation text state). */
  celebrated = 0;
  private readonly active: FxEntry[] = [];
  private readonly textures = new Map<number, CanvasTexture>();

  constructor() {
    this.group.name = 'levelUpFx';
  }

  private texture(level: number): CanvasTexture {
    let cached = this.textures.get(level);
    if (!cached) {
      cached = makeTexture(level);
      this.textures.set(level, cached);
    }
    return cached;
  }

  /** Celebrate at a building's center (world cell coordinates). */
  spawn(x: number, z: number, level: number, nowMs: number): void {
    const material = new SpriteMaterial({
      map: this.texture(level),
      transparent: true,
      depthTest: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(LEVELUP_SPRITE_SCALE * (256 / 96), LEVELUP_SPRITE_SCALE, 1);
    sprite.position.set(x, LEVELUP_START_Y, z);
    this.group.add(sprite);
    this.active.push({ sprite, material, startMs: nowMs, x, z });
    this.celebrated++;
  }

  /** Rise + fade animation; call once per rendered frame. */
  updateFrame(nowMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i];
      const t = (nowMs - fx.startMs) / LEVELUP_DURATION_MS;
      if (t >= 1) {
        this.group.remove(fx.sprite);
        fx.material.dispose();
        this.active.splice(i, 1);
        continue;
      }
      fx.sprite.position.set(fx.x, LEVELUP_START_Y + LEVELUP_RISE_UNITS * t, fx.z);
      fx.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }
  }
}
