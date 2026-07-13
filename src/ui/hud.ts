import type { GameSpeed } from '../protocol/messages';
import { UTILITY_BRIDGE_RADIUS } from '../sim/constants/utilities';
import {
  HUD_COMPACT_PANEL_CHROME_CSS,
  HUD_DIVIDER_COLOR,
  HUD_MILESTONE_BANNER_CSS,
  HUD_MUTED_TEXT,
  HUD_NEGATIVE_TEXT,
  HUD_PANEL_CHROME_CSS,
  HUD_POSITIVE_TEXT,
  hudButtonCss,
  hudKeyBadgeCss,
  hudToastCss,
  hudWarningBadgeCss,
} from './hud-style';

/** Map overlay selection; field names mirror the protocol FieldName literals. */
export type OverlayName =
  | 'none'
  | 'pollution'
  | 'noise'
  | 'landValue'
  | 'traffic'
  | 'power'
  | 'water';

type OverlayLegendItem = { color: string; label: string };
interface OverlayLegend {
  title: string;
  /** Gradient overlays (fields): a low→high colour bar with end labels. */
  gradient?: [string, string];
  lowLabel?: string;
  highLabel?: string;
  /** Discrete overlays (traffic/power/water): labelled colour swatches. */
  items?: OverlayLegendItem[];
}

/**
 * Colour key shown while a map overlay is active, so the heatmap has a scale.
 * Colours mirror the canonical ramps in rendering/constants.ts (FIELD_RAMPS,
 * TRAFFIC_BUCKET_COLORS) and network-overlay.ts — duplicated here as hex strings
 * so the UI layer needn't import from rendering. Keep in sync if those change.
 */
const OVERLAY_LEGENDS: Partial<Record<OverlayName, OverlayLegend>> = {
  pollution: { title: 'Pollution', gradient: ['#46a34a', '#5f4726'], lowLabel: 'Clean', highLabel: 'Heavy' },
  noise: { title: 'Noise', gradient: ['#46a34a', '#7a3fae'], lowLabel: 'Quiet', highLabel: 'Loud' },
  landValue: { title: 'Land value', gradient: ['#d9483f', '#3fae4a'], lowLabel: 'Low', highLabel: 'High' },
  traffic: {
    title: 'Traffic',
    items: [
      { color: '#69a869', label: 'Flowing' },
      { color: '#e3cf4a', label: 'Busy' },
      { color: '#f2953b', label: 'Heavy' },
      { color: '#e0453a', label: 'Jammed' },
    ],
  },
  power: {
    title: 'Power',
    items: [
      { color: '#ffdc50', label: 'Network' },
      { color: '#78d278', label: 'Powered' },
      { color: '#eb3c32', label: 'No power' },
    ],
  },
  water: {
    title: 'Water',
    items: [
      { color: '#5ab4ff', label: 'Pipes' },
      { color: '#78c8dc', label: 'Watered' },
      { color: '#eb3c32', label: 'No water' },
    ],
  },
};

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
  /** Installed capacity vs total building load per utility (the HUD meters). */
  power: { supply: number; demand: number };
  water: { supply: number; demand: number };
  /** A building/structure is being inspected (its panel occupies the bottom-left,
   * so the overlay legend hops above it). */
  inspectOpen: boolean;
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
    title: `Yellow: plants & lines · green: powered buildings · faint halo: connection reach (${UTILITY_BRIDGE_RADIUS} cells) · red: no power`,
  },
  {
    id: 'water',
    label: 'Water 💧',
    title: `Blue: pumps & pipes · teal: watered buildings · faint halo: connection reach (${UTILITY_BRIDGE_RADIUS} cells) · red: no water`,
  },
];
const TOAST_DURATION_MS = 4000;
const MAX_TOASTS = 4;

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
  private readonly powerEl: HTMLSpanElement;
  private readonly waterEl: HTMLSpanElement;
  private readonly warningEl: HTMLSpanElement;
  private readonly statsEl: HTMLSpanElement;
  /** Colour-key panel for the active map overlay (bottom-left, above the camera hint). */
  private readonly legendEl: HTMLDivElement;
  private readonly toastArea: HTMLDivElement;
  private readonly milestoneEl: HTMLDivElement;
  private milestoneTimer: number | undefined;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  /** Live speed, and the last non-zero speed to resume to when Space unpauses. */
  private currentSpeed: GameSpeed = 1;
  private resumeSpeed: GameSpeed = 1;
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
      'position:absolute;top:8px;left:8px;padding:8px 12px;font-size:13px;display:flex;' +
      'gap:12px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 32px);' +
      `user-select:none;z-index:10;${HUD_PANEL_CHROME_CSS}`;

    this.treasuryEl = document.createElement('span');
    this.treasuryEl.style.cssText = `color:${HUD_POSITIVE_TEXT};font-weight:bold`;
    this.root.appendChild(this.treasuryEl);

    this.populationEl = document.createElement('span');
    this.populationEl.style.cssText = 'font-weight:bold';
    this.root.appendChild(this.populationEl);

    this.vehiclesEl = document.createElement('span');
    this.vehiclesEl.title = 'Vehicles on the road';
    this.root.appendChild(this.vehiclesEl);

    this.powerEl = document.createElement('span');
    this.root.appendChild(this.powerEl);
    this.waterEl = document.createElement('span');
    this.root.appendChild(this.waterEl);

    this.warningEl = document.createElement('span');
    this.warningEl.style.cssText = hudWarningBadgeCss();
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
    this.wireSpeedShortcut(callbacks.onSetSpeed);

    this.root.appendChild(this.makeDivider());
    const overlaysLabel = document.createElement('span');
    overlaysLabel.textContent = 'Overlays:';
    overlaysLabel.style.color = HUD_MUTED_TEXT;
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
      `padding:10px 24px;border-radius:11px;font-size:17px;font-weight:bold;${HUD_MILESTONE_BANNER_CSS}` +
      'z-index:12;opacity:0;transition:opacity .45s ease,transform .45s ease;' +
      'pointer-events:none;white-space:nowrap';
    container.appendChild(this.milestoneEl);

    // Subtle, always-on camera legend — new players otherwise have no cue for
    // how to move the view (tool keys are discoverable via button badges).
    const controlsHint = document.createElement('div');
    controlsHint.textContent = 'Camera:  WASD move  ·  scroll zoom  ·  right-drag rotate  ·  Space pause';
    controlsHint.style.cssText =
      'position:absolute;bottom:10px;left:12px;font-size:11px;padding:3px 9px;' +
      `user-select:none;pointer-events:none;z-index:9;opacity:.78;${HUD_COMPACT_PANEL_CHROME_CSS}`;
    container.appendChild(controlsHint);

    this.legendEl = document.createElement('div');
    this.legendEl.style.cssText =
      'position:absolute;bottom:36px;left:12px;min-width:104px;font-size:12px;padding:7px 10px;' +
      `user-select:none;pointer-events:none;z-index:9;display:none;${HUD_COMPACT_PANEL_CHROME_CSS}`;
    container.appendChild(this.legendEl);
  }

  /** Shows a colour key for the active overlay (or hides it for 'none'). The
   * legend sits just above the camera hint, but hops above the inspect panel
   * when one is open (both share the bottom-left corner). */
  private renderOverlayLegend(overlay: OverlayName, inspectOpen: boolean): void {
    const spec = OVERLAY_LEGENDS[overlay];
    if (!spec) {
      this.legendEl.style.display = 'none';
      return;
    }
    this.legendEl.replaceChildren();
    this.legendEl.style.bottom = inspectOpen ? '180px' : '36px';
    this.legendEl.style.display = 'block';
    const title = document.createElement('div');
    title.textContent = spec.title;
    title.style.cssText = 'font-weight:bold;margin-bottom:5px';
    this.legendEl.appendChild(title);
    if (spec.gradient) {
      const bar = document.createElement('div');
      bar.style.cssText = `height:10px;border-radius:2px;background:linear-gradient(to right, ${spec.gradient[0]}, ${spec.gradient[1]})`;
      const ends = document.createElement('div');
      ends.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;opacity:.8;margin-top:3px';
      const lo = document.createElement('span');
      lo.textContent = spec.lowLabel ?? '';
      const hi = document.createElement('span');
      hi.textContent = spec.highLabel ?? '';
      ends.append(lo, hi);
      this.legendEl.append(bar, ends);
    } else if (spec.items) {
      for (const item of spec.items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:7px;line-height:1.5';
        const swatch = document.createElement('span');
        swatch.style.cssText = `width:12px;height:12px;border-radius:2px;flex:none;background:${item.color}`;
        const label = document.createElement('span');
        label.textContent = item.label;
        row.append(swatch, label);
        this.legendEl.appendChild(row);
      }
    }
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
    divider.style.color = HUD_DIVIDER_COLOR;
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
        'background:rgba(110,215,255,.14);border-radius:2px';
      const fill = document.createElement('div');
      fill.style.cssText =
        `position:absolute;bottom:0;left:0;width:100%;height:0;background:${bar.color}`;
      box.appendChild(fill);
      const label = document.createElement('div');
      label.textContent = bar.label;
      label.style.cssText = `font-size:9px;line-height:1;color:${HUD_MUTED_TEXT}`;
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
    badge.style.cssText = hudKeyBadgeCss();
    return badge;
  }

  /** W/A/S/D belong to the camera (scene.ts) — they are never tool shortcuts,
   * regardless of the keymap, so panning can never also fire a tool. */
  private static readonly PAN_KEYS: ReadonlySet<string> = new Set(['w', 'a', 's', 'd']);

  /** Global shortcut keys select tools, unless typing in a field or holding a modifier. */
  /** Space toggles pause ⇄ resume (to the last non-zero speed) — a near-universal
   * game convention. Guards modifiers/text fields and preventDefaults the page scroll. */
  private wireSpeedShortcut(onSetSpeed: (speed: GameSpeed) => void): void {
    window.addEventListener('keydown', (event) => {
      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      onSetSpeed(this.currentSpeed === 0 ? this.resumeSpeed : 0);
    });
  }

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
    button.style.cssText = hudButtonCss(false);
    button.addEventListener('click', onClick);
    this.root.appendChild(button);
    return button;
  }

  update(state: HudState<TTool>): void {
    this.treasuryEl.textContent = formatTreasury(state.treasury);
    this.populationEl.textContent = `👤 ${state.populationPeople.toLocaleString('en-US')} · ${state.cityTitle}`;
    this.vehiclesEl.textContent = `🚗 ${state.vehicles.toLocaleString('en-US')}`;
    this.renderUtilityMeter(this.powerEl, '⚡', 'Power', state.power);
    this.renderUtilityMeter(this.waterEl, '💧', 'Water', state.water);
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
    this.currentSpeed = state.speed;
    if (state.speed !== 0) this.resumeSpeed = state.speed;
    for (const [speed, button] of this.speedButtons) {
      button.style.cssText = hudButtonCss(speed === state.speed);
    }
    for (const [tool, button] of this.toolButtons) {
      button.style.cssText = hudButtonCss(tool === state.activeTool);
    }
    for (const [overlay, button] of this.overlayButtons) {
      button.style.cssText = hudButtonCss(overlay === state.activeOverlay);
    }
    this.renderOverlayLegend(state.activeOverlay, state.inspectOpen);
  }

  /** ⚡/💧 meter: "icon load/capacity", green when capacity covers the load,
   * warm when the network is over capacity (build another plant/pump). Hidden
   * until the city has buildings drawing or a source installed. */
  private renderUtilityMeter(
    el: HTMLSpanElement,
    icon: string,
    noun: string,
    t: { supply: number; demand: number },
  ): void {
    if (t.supply === 0 && t.demand === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'inline';
    el.textContent = `${icon} ${t.demand.toLocaleString('en-US')}/${t.supply.toLocaleString('en-US')}`;
    const covered = t.supply >= t.demand;
    el.style.color = covered ? HUD_POSITIVE_TEXT : HUD_NEGATIVE_TEXT;
    el.title = covered
      ? `${noun}: ${t.demand} used of ${t.supply} capacity`
      : `${noun} over capacity (${t.demand} needed / ${t.supply}) — build another ${noun === 'Power' ? 'plant' : 'pump'}`;
  }

  /** Transient toast, e.g. "Command rejected: not enough money". */
  showToast(message: string): void {
    while (this.toastArea.children.length >= MAX_TOASTS) {
      this.toastArea.removeChild(this.toastArea.children[0]);
    }
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = hudToastCss();
    this.toastArea.appendChild(toast);
    setTimeout(() => toast.remove(), TOAST_DURATION_MS);
  }
}
