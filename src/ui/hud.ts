import type { GameSpeed } from '../protocol/messages';

export interface HudState<TTool extends string> {
  tick: number;
  fps: number;
  speed: GameSpeed;
  treasury: number;
  activeTool: TTool;
}

export interface HudToolSpec<TTool extends string> {
  id: TTool;
  label: string;
}

export interface HudCallbacks<TTool extends string> {
  onSetSpeed(speed: GameSpeed): void;
  onSelectTool(tool: TTool): void;
}

const SPEEDS: GameSpeed[] = [0, 1, 2, 4];
const SPEED_LABELS: Record<GameSpeed, string> = { 0: '⏸', 1: '1×', 2: '2×', 4: '4×' };
const TOAST_DURATION_MS = 4000;
const MAX_TOASTS = 4;

const BUTTON_CSS =
  'background:#2b3d4f;color:#fff;border:1px solid #4a6076;border-radius:4px;' +
  'padding:2px 8px;cursor:pointer;font-size:13px';
const ACTIVE_BG = '#4a7db5';
const IDLE_BG = '#2b3d4f';

function formatTreasury(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** Minimal DOM HUD. Reads pushed state; dispatches via callbacks only — never mutates game state. */
export class Hud<TTool extends string> {
  private readonly root: HTMLDivElement;
  private readonly treasuryEl: HTMLSpanElement;
  private readonly statsEl: HTMLSpanElement;
  private readonly toastArea: HTMLDivElement;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly toolButtons = new Map<TTool, HTMLButtonElement>();

  constructor(
    container: HTMLElement,
    tools: HudToolSpec<TTool>[],
    callbacks: HudCallbacks<TTool>,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;top:8px;left:8px;color:#fff;background:rgba(10,20,30,.72);' +
      'padding:8px 12px;border-radius:8px;font-size:13px;display:flex;gap:12px;align-items:center;' +
      'user-select:none;z-index:10';

    this.treasuryEl = document.createElement('span');
    this.treasuryEl.style.cssText = 'color:#9fdf9f;font-weight:bold';
    this.root.appendChild(this.treasuryEl);

    this.statsEl = document.createElement('span');
    this.root.appendChild(this.statsEl);

    for (const speed of SPEEDS) {
      const button = this.makeButton(SPEED_LABELS[speed], () => callbacks.onSetSpeed(speed));
      this.speedButtons.set(speed, button);
    }

    const divider = document.createElement('span');
    divider.textContent = '|';
    divider.style.color = '#4a6076';
    this.root.appendChild(divider);

    for (const tool of tools) {
      const button = this.makeButton(tool.label, () => callbacks.onSelectTool(tool.id));
      this.toolButtons.set(tool.id, button);
    }
    container.appendChild(this.root);

    this.toastArea = document.createElement('div');
    this.toastArea.style.cssText =
      'position:absolute;top:56px;left:50%;transform:translateX(-50%);display:flex;' +
      'flex-direction:column;gap:6px;align-items:center;z-index:11;pointer-events:none';
    container.appendChild(this.toastArea);
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = BUTTON_CSS;
    button.addEventListener('click', onClick);
    this.root.appendChild(button);
    return button;
  }

  update(state: HudState<TTool>): void {
    this.treasuryEl.textContent = formatTreasury(state.treasury);
    this.statsEl.textContent = `tick ${state.tick} · ${state.fps} fps`;
    for (const [speed, button] of this.speedButtons) {
      button.style.background = speed === state.speed ? ACTIVE_BG : IDLE_BG;
    }
    for (const [tool, button] of this.toolButtons) {
      button.style.background = tool === state.activeTool ? ACTIVE_BG : IDLE_BG;
    }
  }

  /** Transient toast, e.g. "Command rejected: not enough money". */
  showToast(message: string): void {
    while (this.toastArea.children.length >= MAX_TOASTS) {
      this.toastArea.removeChild(this.toastArea.children[0]);
    }
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText =
      'color:#fff;background:rgba(150,40,40,.9);padding:6px 14px;border-radius:6px;' +
      'font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,.4)';
    this.toastArea.appendChild(toast);
    setTimeout(() => toast.remove(), TOAST_DURATION_MS);
  }
}
