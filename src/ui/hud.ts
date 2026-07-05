import type { GameSpeed } from '../protocol/messages';

/** Map overlay selection; field names mirror the protocol FieldName literals. */
export type OverlayName =
  | 'none'
  | 'pollution'
  | 'noise'
  | 'landValue'
  | 'traffic'
  | 'power'
  | 'water';

export interface HudState<TTool extends string> {
  /** In-game day number (player-facing time; raw tick/fps stay in the automation state only). */
  day: number;
  speed: GameSpeed;
  treasury: number;
  /** Display population (citizens × people-per-citizen, computed by the app layer). */
  populationPeople: number;
  /** Player-facing city rank title (Settlement…Metropolis), shown by the count. */
  cityTitle: string;
  /** RCI demand in [-1, 1]; bars show only the positive part. */
  demand: { r: number; c: number; i: number };
  activeTool: TTool;
  activeOverlay: OverlayName;
  /** Live vehicle count from the sim's frame stats. */
  vehicles: number;
  /** Cumulative trips that found no route — shows a warning badge when > 0. */
  disconnectedTrips: number;
}

export interface HudToolSpec<TTool extends string> {
  id: TTool;
  label: string;
  /** Hover tooltip explaining what the tool does and how it connects. */
  title?: string;
  /** Single-key shortcut (case-insensitive); shown as a badge on the button. */
  key?: string;
}

export interface HudCallbacks<TTool extends string> {
  onSetSpeed(speed: GameSpeed): void;
  onSelectTool(tool: TTool): void;
  onSelectOverlay(overlay: OverlayName): void;
  onToggleBudget(): void;
  onSave(): void;
  onLoad(): void;
  onNewCity(): void;
}

const SPEEDS: GameSpeed[] = [0, 1, 2, 4];
const SPEED_LABELS: Record<GameSpeed, string> = { 0: '⏸', 1: '1×', 2: '2×', 4: '4×' };
const OVERLAYS: { id: OverlayName; label: string; title?: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'pollution', label: 'Pollution' },
  { id: 'noise', label: 'Noise' },
  { id: 'landValue', label: 'Land value' },
  { id: 'traffic', label: 'Traffic', title: 'Road congestion: green → red by traffic load' },
  {
    id: 'power',
    label: 'Power ⚡',
    title: 'Yellow: plants & lines · green: powered buildings · faint halo: connection reach (2 cells) · red: no power',
  },
  {
    id: 'water',
    label: 'Water 💧',
    title: 'Blue: pumps & pipes · teal: watered buildings · faint halo: connection reach (2 cells) · red: no water',
  },
];
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
  private readonly vehiclesEl: HTMLSpanElement;
  private readonly warningEl: HTMLSpanElement;
  private readonly statsEl: HTMLSpanElement;
  private readonly toastArea: HTMLDivElement;
  private readonly milestoneEl: HTMLDivElement;
  private milestoneTimer: number | undefined;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly toolButtons = new Map<TTool, HTMLButtonElement>();
  private readonly overlayButtons = new Map<OverlayName, HTMLButtonElement>();
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
      'flex-wrap:wrap;max-width:calc(100vw - 32px);user-select:none;z-index:10';

    this.treasuryEl = document.createElement('span');
    this.treasuryEl.style.cssText = 'color:#9fdf9f;font-weight:bold';
    this.root.appendChild(this.treasuryEl);

    this.populationEl = document.createElement('span');
    this.populationEl.style.cssText = 'font-weight:bold';
    this.root.appendChild(this.populationEl);

    this.vehiclesEl = document.createElement('span');
    this.vehiclesEl.title = 'Vehicles on the road';
    this.root.appendChild(this.vehiclesEl);

    this.warningEl = document.createElement('span');
    this.warningEl.style.cssText =
      'color:#1a1a1a;background:#ffb347;font-weight:bold;border-radius:4px;' +
      'padding:1px 6px;display:none';
    this.root.appendChild(this.warningEl);

    this.root.appendChild(this.makeDemandBars());

    this.statsEl = document.createElement('span');
    this.root.appendChild(this.statsEl);

    for (const speed of SPEEDS) {
      const button = this.makeButton(SPEED_LABELS[speed], () => callbacks.onSetSpeed(speed));
      this.speedButtons.set(speed, button);
    }

    const keyToTool = new Map<string, TTool>();
    for (const group of toolGroups) {
      this.root.appendChild(this.makeDivider());
      for (const tool of group) {
        const title = tool.key
          ? `${tool.title ? `${tool.title}. ` : ''}Shortcut: ${tool.key.toUpperCase()}`
          : tool.title;
        const button = this.makeButton(tool.label, () => callbacks.onSelectTool(tool.id), title);
        if (tool.key) {
          button.appendChild(this.keyBadge(tool.key));
          keyToTool.set(tool.key.toLowerCase(), tool.id);
        }
        this.toolButtons.set(tool.id, button);
      }
    }
    this.wireToolShortcuts(keyToTool, callbacks.onSelectTool);

    this.root.appendChild(this.makeDivider());
    const overlaysLabel = document.createElement('span');
    overlaysLabel.textContent = 'Overlays:';
    overlaysLabel.style.color = '#c9d4dd';
    this.root.appendChild(overlaysLabel);
    for (const overlay of OVERLAYS) {
      const button = this.makeButton(overlay.label, () => callbacks.onSelectOverlay(overlay.id), overlay.title);
      this.overlayButtons.set(overlay.id, button);
    }
    this.root.appendChild(this.makeDivider());
    this.makeButton('💰 Budget', () => callbacks.onToggleBudget(), 'Income, expenses, and per-zone tax sliders');
    this.makeButton('💾 Save', () => callbacks.onSave());
    this.makeButton('📂 Load', () => callbacks.onLoad());
    this.makeButton('✨ New', () => callbacks.onNewCity());

    container.appendChild(this.root);

    this.toastArea = document.createElement('div');
    this.toastArea.style.cssText =
      'position:absolute;top:56px;left:50%;transform:translateX(-50%);display:flex;' +
      'flex-direction:column;gap:6px;align-items:center;z-index:11;pointer-events:none';
    container.appendChild(this.toastArea);

    // Celebratory population-milestone banner (distinct from the red toasts).
    this.milestoneEl = document.createElement('div');
    this.milestoneEl.style.cssText =
      'position:absolute;top:84px;left:50%;transform:translateX(-50%) translateY(-10px);' +
      'padding:10px 24px;border-radius:11px;color:#fff2cf;font-size:17px;font-weight:bold;' +
      'background:linear-gradient(180deg,rgba(42,64,44,.95),rgba(24,40,28,.95));' +
      'border:1px solid rgba(255,214,110,.75);box-shadow:0 5px 20px rgba(0,0,0,.5);' +
      'z-index:12;opacity:0;transition:opacity .45s ease,transform .45s ease;' +
      'pointer-events:none;white-space:nowrap';
    container.appendChild(this.milestoneEl);

    // Subtle, always-on camera legend — new players otherwise have no cue for
    // how to move the view (tool keys are discoverable via button badges).
    const controlsHint = document.createElement('div');
    controlsHint.textContent = 'Camera:  WASD move  ·  scroll zoom  ·  right-drag rotate';
    controlsHint.style.cssText =
      'position:absolute;bottom:10px;left:12px;color:#cfe0ea;font-size:11px;' +
      'background:rgba(10,20,30,.5);padding:3px 9px;border-radius:5px;' +
      'user-select:none;pointer-events:none;z-index:9;opacity:.72';
    container.appendChild(controlsHint);
  }

  /** A one-off, self-fading celebration banner (population milestones). */
  showMilestone(text: string): void {
    this.milestoneEl.textContent = text;
    this.milestoneEl.style.opacity = '1';
    this.milestoneEl.style.transform = 'translateX(-50%) translateY(0)';
    if (this.milestoneTimer !== undefined) clearTimeout(this.milestoneTimer);
    this.milestoneTimer = window.setTimeout(() => {
      this.milestoneEl.style.opacity = '0';
      this.milestoneEl.style.transform = 'translateX(-50%) translateY(-10px)';
    }, 4500);
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

  /** Small keycap badge appended to a tool button showing its shortcut. */
  private keyBadge(key: string): HTMLSpanElement {
    const badge = document.createElement('span');
    badge.textContent = key.toUpperCase();
    badge.style.cssText =
      'margin-left:5px;padding:0 3px;font-size:9px;font-weight:bold;line-height:13px;' +
      'display:inline-block;min-width:9px;text-align:center;color:#bfe6ff;' +
      'background:rgba(0,0,0,.28);border:1px solid rgba(143,224,255,.4);border-radius:3px';
    return badge;
  }

  /** W/A/S/D belong to the camera (scene.ts) — they are never tool shortcuts,
   * regardless of the keymap, so panning can never also fire a tool. */
  private static readonly PAN_KEYS: ReadonlySet<string> = new Set(['w', 'a', 's', 'd']);

  /** Global shortcut keys select tools, unless typing in a field or holding a modifier. */
  private wireToolShortcuts(keyToTool: Map<string, TTool>, onSelectTool: (tool: TTool) => void): void {
    window.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (Hud.PAN_KEYS.has(key)) return; // reserved for camera panning
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const tool = keyToTool.get(key);
      if (tool !== undefined) {
        event.preventDefault();
        onSelectTool(tool);
      }
    });
  }

  private makeButton(label: string, onClick: () => void, title?: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    if (title) button.title = title;
    button.style.cssText = BUTTON_CSS;
    button.addEventListener('click', onClick);
    this.root.appendChild(button);
    return button;
  }

  update(state: HudState<TTool>): void {
    this.treasuryEl.textContent = formatTreasury(state.treasury);
    this.populationEl.textContent = `👤 ${state.populationPeople.toLocaleString('en-US')} · ${state.cityTitle}`;
    this.vehiclesEl.textContent = `🚗 ${state.vehicles.toLocaleString('en-US')}`;
    const warnings: string[] = [];
    const tips: string[] = [];
    if (state.treasury < 0) {
      warnings.push('⚠ BROKE');
      tips.push('Treasury is negative — only power/water purchases are allowed until income recovers');
    }
    if (state.disconnectedTrips > 0) {
      warnings.push(`⚠ ${state.disconnectedTrips.toLocaleString('en-US')}`);
      tips.push(`${state.disconnectedTrips} trips could not find a route — check road connectivity`);
    }
    if (warnings.length > 0) {
      this.warningEl.textContent = warnings.join('  ');
      this.warningEl.title = tips.join('; ');
      this.warningEl.style.display = 'inline';
    } else {
      this.warningEl.style.display = 'none';
    }
    this.statsEl.textContent = `Day ${state.day}`;
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
    for (const [overlay, button] of this.overlayButtons) {
      button.style.background = overlay === state.activeOverlay ? ACTIVE_BG : IDLE_BG;
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
