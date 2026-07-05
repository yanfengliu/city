import { GroundPicker } from '../rendering/picking';
import { GRID_HEIGHT, GRID_WIDTH } from '../sim/constants/map';
import type { CityScene } from '../rendering/scene';

/**
 * Drives the game through the SAME path a human uses — real pointer events on
 * the canvas (→ GroundPicker → Tools), real keyboard, and real HUD button
 * clicks — plus a screenshot of exactly what the player sees. Unlike the
 * `command` backdoor (which calls `world.submit` directly and skips the UI),
 * every action here exercises the full stack: picking, ghost validity, tool
 * state, buttons, and shortcuts — so a playtest catches UI bugs, not just sim
 * bugs. Aim clicks with `where()` (a sim cell → screen pixels).
 */
export interface PlayerInput {
  /** JPEG data URL of the rendered scene — the player's-eye view. */
  screenshot(quality?: number): string;
  /** Screen pixels for the centre of sim cell (x, y); `onScreen` false if off-view. */
  where(x: number, y: number): { sx: number; sy: number; onScreen: boolean };
  /** The sim cell under a screen pixel (inverse of `where`; null off-grid). */
  cellAt(sx: number, sy: number): { x: number; y: number } | null;
  /** Left-drag across the map (roads, zones, lines, pipes, bulldoze, dezone). Select the tool first. */
  dragMap(from: { x: number; y: number }, to: { x: number; y: number }): void;
  /** Left-click one map cell (place a service/plant/pump, or inspect with Select). */
  tapMap(cell: { x: number; y: number }): void;
  /** Raw-pixel left-click. */
  clickAt(sx: number, sy: number): void;
  /** Raw-pixel drag (button 0 left / 2 right / 1 middle). */
  dragAt(sx1: number, sy1: number, sx2: number, sy2: number, button?: number): void;
  /** Press a keyboard key (tool shortcut, W/A/S/D pan, Escape). */
  key(k: string): void;
  /** Click a HUD button by visible label ("Road", "Zone R", "Coal ⚡", "2×", "Pollution", "💰 Budget"…). Returns whether one matched. */
  hud(label: string): boolean;
}

/** attachInput best-effort-captures the pointer; a synthetic pointerId throws,
 * so neutralize capture for the duration of a dispatched gesture. */
function withoutPointerCapture(el: HTMLElement, run: () => void): void {
  const cap = el.setPointerCapture.bind(el);
  const rel = el.releasePointerCapture.bind(el);
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  try {
    run();
  } finally {
    el.setPointerCapture = cap;
    el.releasePointerCapture = rel;
  }
}

function pointer(el: HTMLElement, type: string, sx: number, sy: number, button: number, buttons: number): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      button,
      buttons,
      clientX: sx,
      clientY: sy,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function createPlayerInput(scene: CityScene): PlayerInput {
  const el = scene.renderer.domElement;
  const picker = new GroundPicker(scene.camera, el, GRID_WIDTH, GRID_HEIGHT);

  const dragAt: PlayerInput['dragAt'] = (sx1, sy1, sx2, sy2, button = 0) => {
    const buttons = button === 0 ? 1 : button === 2 ? 2 : 4;
    withoutPointerCapture(el, () => {
      pointer(el, 'pointerdown', sx1, sy1, button, buttons);
      pointer(el, 'pointermove', (sx1 + sx2) / 2, (sy1 + sy2) / 2, button, buttons);
      pointer(el, 'pointermove', sx2, sy2, button, buttons);
      pointer(el, 'pointerup', sx2, sy2, button, 0);
    });
  };

  const clickAt: PlayerInput['clickAt'] = (sx, sy) => {
    withoutPointerCapture(el, () => {
      pointer(el, 'pointerdown', sx, sy, 0, 1);
      pointer(el, 'pointerup', sx, sy, 0, 0);
    });
  };

  const where = (x: number, y: number) => scene.worldToScreen(x + 0.5, y + 0.5);

  return {
    screenshot: (quality) => scene.screenshot(quality),
    where,
    cellAt: (sx, sy) => picker.pick(sx, sy),
    dragMap: (from, to) => {
      const a = where(from.x, from.y);
      const b = where(to.x, to.y);
      dragAt(a.sx, a.sy, b.sx, b.sy);
    },
    tapMap: (cell) => {
      const p = where(cell.x, cell.y);
      clickAt(p.sx, p.sy);
    },
    clickAt,
    dragAt,
    key: (k) => {
      for (const type of ['keydown', 'keyup']) {
        window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
      }
    },
    hud: (label) => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        (b.textContent ?? '').includes(label),
      );
      if (!button) return false;
      button.click();
      return true;
    },
  };
}
