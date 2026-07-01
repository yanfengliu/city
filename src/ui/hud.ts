import type { GameSpeed } from '../protocol/messages';

export interface HudState {
  tick: number;
  fps: number;
  speed: GameSpeed;
}

const SPEEDS: GameSpeed[] = [0, 1, 2, 4];
const SPEED_LABELS: Record<GameSpeed, string> = { 0: '⏸', 1: '1×', 2: '2×', 4: '4×' };

/** Minimal DOM HUD. Reads pushed state; dispatches commands via callbacks only. */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly statsEl: HTMLSpanElement;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();

  constructor(container: HTMLElement, onSetSpeed: (speed: GameSpeed) => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;top:8px;left:8px;color:#fff;background:rgba(10,20,30,.72);' +
      'padding:8px 12px;border-radius:8px;font-size:13px;display:flex;gap:12px;align-items:center;' +
      'user-select:none;z-index:10';

    this.statsEl = document.createElement('span');
    this.root.appendChild(this.statsEl);

    for (const speed of SPEEDS) {
      const button = document.createElement('button');
      button.textContent = SPEED_LABELS[speed];
      button.style.cssText =
        'background:#2b3d4f;color:#fff;border:1px solid #4a6076;border-radius:4px;' +
        'padding:2px 8px;cursor:pointer;font-size:13px';
      button.addEventListener('click', () => onSetSpeed(speed));
      this.speedButtons.set(speed, button);
      this.root.appendChild(button);
    }
    container.appendChild(this.root);
  }

  update(state: HudState): void {
    this.statsEl.textContent = `tick ${state.tick} · ${state.fps} fps`;
    for (const [speed, button] of this.speedButtons) {
      button.style.background = speed === state.speed ? '#4a7db5' : '#2b3d4f';
    }
  }
}
