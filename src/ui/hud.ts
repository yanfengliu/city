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
  HUD_TOP_BAR_LAYOUT_CSS,
  hudButtonCss,
  hudKeyBadgeCss,
  hudStatSlotCss,
  hudToastCss,
  hudWarningBadgeCss,
} from './hud-style';
import { OverlayLegendView } from './overlay-legend';
import { nextOverlay, type OverlayName } from './overlay-toggle';

export type { OverlayName } from './overlay-toggle';

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
  pedestrians: number;
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
/** Coverage raises land value where it reaches; its absence never abandons a
 * building, so these overlays stay green/grey and never escalate to red. */
const COVERAGE_TITLE =
  'Blue: the service building · green: covered (raises land value) · grey: not covered';

const OVERLAYS: { id: OverlayName; label: string; title?: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'pollution', label: 'Pollution' },
  { id: 'noise', label: 'Noise' },
  { id: 'landValue', label: 'Land value' },
  { id: 'traffic', label: 'Traffic', title: 'Road congestion: green → red by traffic load' },
  {
    id: 'power',
    label: 'Power ⚡',
    title: `Blue: plants & lines · green: powered buildings · faint halo: connection reach (${UTILITY_BRIDGE_RADIUS} cells) · yellow: no power · red: near abandonment`,
  },
  {
    id: 'water',
    label: 'Water 💧',
    title: `Blue: pumps & pipes · green: watered buildings · faint halo: connection reach (${UTILITY_BRIDGE_RADIUS} cells) · yellow: no water · red: near abandonment`,
  },
  { id: 'fireCoverage', label: 'Fire 🚒', title: COVERAGE_TITLE },
  { id: 'policeCoverage', label: 'Police 🚓', title: COVERAGE_TITLE },
  { id: 'healthCoverage', label: 'Health 🏥', title: COVERAGE_TITLE },
  { id: 'educationCoverage', label: 'Education 🎓', title: COVERAGE_TITLE },
  { id: 'parkCoverage', label: 'Parks 🌳', title: COVERAGE_TITLE },
  { id: 'gardenCoverage', label: 'Gardens 🌻', title: COVERAGE_TITLE },
];
/** Button order actually rendered; pinned against OVERLAY_IDS so the toggle
 * logic and the buttons can never disagree about which overlays exist. */
export const OVERLAY_BUTTON_IDS: readonly OverlayName[] = OVERLAYS.map((o) => o.id);

const TOAST_DURATION_MS = 4000;
const MAX_TOASTS = 4;

/**
 * Reserved widths (in ch) for the bar's live values, sized to their on-screen
 * maxima — "$9,999,999", "9,999,999" people, "Metropolis", "99,999" vehicles,
 * "999,999" utility units, "Day 9999" — plus one extra ch of sub-pixel safety
 * margin (browser-measured at 13px system-ui: the maxima land within half a
 * pixel of their exact ch width, and any overflow would move wrap points).
 * Values render inside fixed slots (hudStatSlotCss) so a changing number or
 * rank can never move its neighbours or re-flow the bar's wrap points
 * (tests/ui/hud-layout.test.ts pins the floors; verified live at 1280×800).
 */
export const STAT_SLOT_CH = {
  treasury: 11,
  population: 10,
  cityTitle: 11,
  traffic: 7,
  utility: 7,
  day: 9,
} as const;

/**
 * Slots are born holding a no-break space, never empty: an empty inline-block
 * aligns by its box bottom instead of the text baseline, so the first real
 * value would change the row's line box and nudge the whole bar by a pixel.
 */
const SLOT_PLACEHOLDER = '\u00a0';

const DEMAND_BAR_HEIGHT_PX = 20;
const DEMAND_BARS: { key: 'r' | 'c' | 'i'; label: string; color: string }[] = [
  { key: 'r', label: 'R', color: '#58c15c' },
  { key: 'c', label: 'C', color: '#5b8fdd' },
  { key: 'i', label: 'I', color: '#e09b3d' },
];

function formatTreasury(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** The "⚡ demand/supply" meter: both numbers live in fixed slots either side of a static slash. */
interface UtilityMeterEls {
  root: HTMLSpanElement;
  demand: HTMLSpanElement;
  supply: HTMLSpanElement;
  /** Tooltip wording: the utility noun and what to build when over capacity. */
  noun: string;
  source: string;
}

/** Minimal DOM HUD. Reads pushed state; dispatches via callbacks only — never mutates game state. */
export class Hud<TTool extends string> {
  private readonly root: HTMLDivElement;
  private readonly treasuryEl: HTMLSpanElement;
  private readonly popCountEl: HTMLSpanElement;
  private readonly cityTitleEl: HTMLSpanElement;
  private readonly vehicleCountEl: HTMLSpanElement;
  private readonly pedestrianCountEl: HTMLSpanElement;
  private readonly powerMeter: UtilityMeterEls;
  private readonly waterMeter: UtilityMeterEls;
  private readonly warningEl: HTMLSpanElement;
  private readonly statsEl: HTMLSpanElement;
  /** Colour-key panel for the active map overlay (bottom-left, above the camera hint). */
  private readonly legend: OverlayLegendView;
  private readonly toastArea: HTMLDivElement;
  private readonly milestoneEl: HTMLDivElement;
  private milestoneTimer: number | undefined;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  /** Live speed, and the last non-zero speed to resume to when Space unpauses. */
  private currentSpeed: GameSpeed = 1;
  private resumeSpeed: GameSpeed = 1;
  private readonly toolButtons = new Map<TTool, HTMLButtonElement>();
  private readonly overlayButtons = new Map<OverlayName, HTMLButtonElement>();
  /** Latest rendered overlay — a click needs it to decide toggle-off vs switch. */
  private activeOverlay: OverlayName = 'none';
  private readonly demandFills = new Map<'r' | 'c' | 'i', HTMLDivElement>();

  constructor(
    container: HTMLElement,
    toolGroups: HudToolSpec<TTool>[][],
    callbacks: HudCallbacks<TTool>,
  ) {
    this.root = document.createElement('div');
    this.root.dataset.cityHud = 'top';
    this.root.style.cssText = `${HUD_TOP_BAR_LAYOUT_CSS}${HUD_PANEL_CHROME_CSS}`;

    this.treasuryEl = this.makeStatSlot(STAT_SLOT_CH.treasury);
    this.treasuryEl.style.color = HUD_POSITIVE_TEXT;
    this.treasuryEl.style.fontWeight = 'bold';
    this.root.appendChild(this.treasuryEl);

    const populationEl = document.createElement('span');
    populationEl.style.cssText = 'font-weight:bold';
    this.popCountEl = this.makeStatSlot(STAT_SLOT_CH.population);
    this.cityTitleEl = this.makeStatSlot(STAT_SLOT_CH.cityTitle);
    populationEl.append('👤 ', this.popCountEl, ' · ', this.cityTitleEl);
    this.root.appendChild(populationEl);

    const vehiclesEl = document.createElement('span');
    vehiclesEl.title = 'Vehicles and pedestrians on the street';
    this.vehicleCountEl = this.makeStatSlot(STAT_SLOT_CH.traffic);
    this.pedestrianCountEl = this.makeStatSlot(STAT_SLOT_CH.traffic);
    vehiclesEl.append('🚗 ', this.vehicleCountEl, ' · 🚶 ', this.pedestrianCountEl);
    this.root.appendChild(vehiclesEl);

    this.powerMeter = this.makeUtilityMeter('⚡', 'Power', 'plant');
    this.waterMeter = this.makeUtilityMeter('💧', 'Water', 'pump');

    this.warningEl = document.createElement('span');
    this.warningEl.style.cssText = hudWarningBadgeCss();
    this.root.appendChild(this.warningEl);

    this.root.appendChild(this.makeDemandBars());

    this.statsEl = this.makeStatSlot(STAT_SLOT_CH.day);
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
      // Toggle, not radio: pressing the active overlay clears it, so leaving
      // costs the same click as entering (see ui/overlay-toggle.ts).
      const button = this.makeButton(
        overlay.label,
        () => callbacks.onSelectOverlay(nextOverlay(overlay.id, this.activeOverlay)),
        overlay.title,
      );
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

    this.legend = new OverlayLegendView(container);
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
    this.popCountEl.textContent = state.populationPeople.toLocaleString('en-US');
    this.cityTitleEl.textContent = state.cityTitle;
    this.vehicleCountEl.textContent = state.vehicles.toLocaleString('en-US');
    this.pedestrianCountEl.textContent = state.pedestrians.toLocaleString('en-US');
    this.renderUtilityMeter(this.powerMeter, state.power);
    this.renderUtilityMeter(this.waterMeter, state.water);
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
    this.activeOverlay = state.activeOverlay;
    for (const [overlay, button] of this.overlayButtons) {
      button.style.cssText = hudButtonCss(overlay === state.activeOverlay);
    }
    this.legend.render(state.activeOverlay, state.inspectOpen);
  }

  /** Builds a "⚡ demand/supply" meter whose slot is reserved from day one:
   * it hides via visibility (never display), so appearing when the first
   * plant/pump lands cannot re-flow the bar. */
  private makeUtilityMeter(icon: string, noun: string, source: string): UtilityMeterEls {
    const root = document.createElement('span');
    root.style.visibility = 'hidden';
    const demand = this.makeStatSlot(STAT_SLOT_CH.utility, 'right');
    const supply = this.makeStatSlot(STAT_SLOT_CH.utility);
    root.append(`${icon} `, demand, '/', supply);
    this.root.appendChild(root);
    return { root, demand, supply, noun, source };
  }

  /** A fixed-width value slot (hudStatSlotCss). Born holding SLOT_PLACEHOLDER —
   * never empty — so its baseline geometry is identical before and after the
   * first real value lands (an empty inline-block aligns by box bottom and
   * would nudge the whole row). */
  private makeStatSlot(minWidthCh: number, align: 'left' | 'right' = 'left'): HTMLSpanElement {
    const slot = document.createElement('span');
    slot.style.cssText = hudStatSlotCss(minWidthCh, align);
    slot.textContent = SLOT_PLACEHOLDER;
    return slot;
  }

  /** ⚡/💧 meter: "icon load/capacity", green when capacity covers the load,
   * warm when the network is over capacity (build another plant/pump). Hidden
   * (but still occupying its reserved slot) until the city has buildings
   * drawing or a source installed. */
  private renderUtilityMeter(meter: UtilityMeterEls, t: { supply: number; demand: number }): void {
    if (t.supply === 0 && t.demand === 0) {
      meter.root.style.visibility = 'hidden';
      return;
    }
    meter.root.style.visibility = 'visible';
    meter.demand.textContent = t.demand.toLocaleString('en-US');
    meter.supply.textContent = t.supply.toLocaleString('en-US');
    const covered = t.supply >= t.demand;
    meter.root.style.color = covered ? HUD_POSITIVE_TEXT : HUD_NEGATIVE_TEXT;
    meter.root.title = covered
      ? `${meter.noun}: ${t.demand} used of ${t.supply} capacity`
      : `${meter.noun} over capacity (${t.demand} needed / ${t.supply}) — build another ${meter.source}`;
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
