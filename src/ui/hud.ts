import type { GameSpeed } from '../protocol/messages';

export interface HudState<TTool extends string> {
  tick: number;
  fps: number;
  speed: GameSpeed;
  treasury: number;
  /** Display population (citizens × people-per-citizen, computed by the app layer). */
  populationPeople: number;
  /** RCI demand in [-1, 1]; bars show only the positive part. */
  demand: { r: number; c: number; i: number };
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

const DEMAND_BAR_HEIGHT_PX = 20;
const DEMAND_BARS: { key: 'r' | 'c' | 'i'; label: string; color: string }[] = [
  { key: 'r', label: 'R', color: '#58c15c' },
  { key: 'c', label: 'C', color: '#5b8fdd' },
  { key: 'i', label: 'I', color: '#e09b3d' },
];

function formatTreasury(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** Minimal DOM HUD. Reads pushed state; dispatches via callbacks only — never mutates game state. */
export class Hud<TTool extends string> {
  private readonly root: HTMLDivElement;
  private readonly treasuryEl: HTMLSpanElement;
  private readonly populationEl: HTMLSpanElement;
  private readonly statsEl: HTMLSpanElement;
  private readonly toastArea: HTMLDivElement;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly toolButtons = new Map<TTool, HTMLButtonElement>();
  private readonly demandFills = new Map<'r' | 'c' | 'i', HTMLDivElement>();

  constructor(
    container: HTMLElement,
    toolGroups: HudToolSpec<TTool>[][],
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

    this.populationEl = document.createElement('span');
    this.populationEl.style.cssText = 'font-weight:bold';
    this.root.appendChild(this.populationEl);

    this.root.appendChild(this.makeDemandBars());

    this.statsEl = document.createElement('span');
    this.root.appendChild(this.statsEl);

    for (const speed of SPEEDS) {
      const button = this.makeButton(SPEED_LABELS[speed], () => callbacks.onSetSpeed(speed));
      this.speedButtons.set(speed, button);
    }

    for (const group of toolGroups) {
      this.root.appendChild(this.makeDivider());
      for (const tool of group) {
        const button = this.makeButton(tool.label, () => callbacks.onSelectTool(tool.id));
        this.toolButtons.set(tool.id, button);
      }
    }
    container.appendChild(this.root);

    this.toastArea = document.createElement('div');
    this.toastArea.style.cssText =
      'position:absolute;top:56px;left:50%;transform:translateX(-50%);display:flex;' +
      'flex-direction:column;gap:6px;align-items:center;z-index:11;pointer-events:none';
    container.appendChild(this.toastArea);
  }

  private makeDivider(): HTMLSpanElement {
    const divider = document.createElement('span');
    divider.textContent = '|';
    divider.style.color = '#4a6076';
    return divider;
  }

  /** Three vertical RCI bars; fill height ∝ max(0, demand), labeled R/C/I underneath. */
  private makeDemandBars(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:flex-end';
    for (const bar of DEMAND_BARS) {
      const column = document.createElement('div');
      column.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:1px';
      const box = document.createElement('div');
      box.style.cssText =
        `width:7px;height:${DEMAND_BAR_HEIGHT_PX}px;position:relative;overflow:hidden;` +
        'background:rgba(255,255,255,.15);border-radius:2px';
      const fill = document.createElement('div');
      fill.style.cssText =
        `position:absolute;bottom:0;left:0;width:100%;height:0;background:${bar.color}`;
      box.appendChild(fill);
      const label = document.createElement('div');
      label.textContent = bar.label;
      label.style.cssText = 'font-size:9px;line-height:1;color:#c9d4dd';
      column.appendChild(box);
      column.appendChild(label);
      wrap.appendChild(column);
      this.demandFills.set(bar.key, fill);
    }
    return wrap;
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
    this.populationEl.textContent = `👤 ${state.populationPeople.toLocaleString('en-US')}`;
    this.statsEl.textContent = `tick ${state.tick} · ${state.fps} fps`;
    for (const bar of DEMAND_BARS) {
      const fill = this.demandFills.get(bar.key);
      if (fill) fill.style.height = `${Math.round(Math.max(0, state.demand[bar.key]) * 100)}%`;
    }
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
