import { overlayStatusCss } from '../rendering/overlay-semantics';
import { HUD_NEGATIVE_TEXT, HUD_PANEL_CHROME_CSS, hudIconButtonCss } from './hud-style';

/** At or above this the bar reads green; below METER_WARN_AT it reads red. */
const METER_GOOD_AT = 0.6;
const METER_WARN_AT = 0.3;

/** A labelled 0..1 bar, e.g. a citizen's happiness. */
export interface InspectMeter {
  /** e.g. "Happiness". */
  label: string;
  /** Clamped to 0..1 by the panel; drives both the bar and its colour. */
  value: number;
  /** Right-hand caption, e.g. "72% — content". */
  caption: string;
}

/** Pre-formatted details (the app layer owns all sim math and wording). */
export interface InspectData {
  /** e.g. "Residential — Level 2". */
  title: string;
  /** Detail lines, e.g. "Footprint: 2×2 cells", "Residents: 9 / 12 people". */
  lines: string[];
  abandoned: boolean;
  /** Optional headline bar shown above the lines (people show happiness). */
  meter?: InspectMeter;
}

/**
 * Small bottom-left building info panel shown by the select tool. Purely
 * presentational: receives display-ready strings, dispatches only the close
 * callback (the app layer owns what "closed" means).
 */
export class InspectPanel {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly badgeEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly meterEl: HTMLDivElement;
  private readonly meterLabelEl: HTMLDivElement;
  private readonly meterTrackEl: HTMLDivElement;
  private readonly meterFillEl: HTMLDivElement;

  constructor(container: HTMLElement, onClose: () => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;bottom:8px;left:8px;min-width:190px;padding:10px 12px;font-size:13px;' +
      `display:none;user-select:none;z-index:10;${HUD_PANEL_CHROME_CSS}`;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px';
    this.titleEl = document.createElement('span');
    this.titleEl.style.cssText = 'font-weight:bold';
    header.appendChild(this.titleEl);

    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = hudIconButtonCss();
    closeButton.addEventListener('click', onClose);
    header.appendChild(closeButton);
    this.root.appendChild(header);

    this.badgeEl = document.createElement('div');
    this.badgeEl.textContent = 'Abandoned';
    this.badgeEl.style.cssText = `color:${HUD_NEGATIVE_TEXT};font-weight:bold;margin-top:4px;display:none`;
    this.root.appendChild(this.badgeEl);

    // Happiness bar. Built once and toggled, so showing a person after a
    // building cannot re-flow the panel's other rows.
    this.meterEl = document.createElement('div');
    this.meterEl.style.cssText = 'margin-top:7px;display:none';
    this.meterLabelEl = document.createElement('div');
    this.meterLabelEl.style.cssText =
      'display:flex;justify-content:space-between;gap:10px;font-size:12px;opacity:.85';
    this.meterTrackEl = document.createElement('div');
    this.meterTrackEl.style.cssText =
      'height:8px;margin-top:3px;border-radius:4px;overflow:hidden;background:rgba(20,40,45,.18)';
    this.meterFillEl = document.createElement('div');
    this.meterFillEl.style.cssText = 'height:100%;width:0%';
    this.meterTrackEl.appendChild(this.meterFillEl);
    this.meterEl.append(this.meterLabelEl, this.meterTrackEl);
    this.root.appendChild(this.meterEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText = 'margin-top:6px;display:flex;flex-direction:column;gap:2px';
    this.root.appendChild(this.bodyEl);

    container.appendChild(this.root);
  }

  show(data: InspectData): void {
    this.titleEl.textContent = data.title;
    this.badgeEl.style.display = data.abandoned ? 'block' : 'none';
    this.renderMeter(data.meter);
    this.bodyEl.replaceChildren(
      ...data.lines.map((line) => {
        const row = document.createElement('div');
        row.textContent = line;
        return row;
      }),
    );
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /**
   * Fills the happiness bar, borrowing the map overlays' status colours so a
   * thriving person reads green and a miserable one red exactly as a served
   * or failing building does (rendering/overlay-semantics.ts).
   */
  private renderMeter(meter: InspectMeter | undefined): void {
    if (!meter) {
      this.meterEl.style.display = 'none';
      return;
    }
    const value = Math.min(Math.max(meter.value, 0), 1);
    this.meterLabelEl.replaceChildren();
    const label = document.createElement('span');
    label.textContent = meter.label;
    const caption = document.createElement('span');
    caption.textContent = meter.caption;
    this.meterLabelEl.append(label, caption);
    this.meterFillEl.style.width = `${Math.round(value * 100)}%`;
    this.meterFillEl.style.background = overlayStatusCss(meterStatus(value));
    this.meterEl.style.display = 'block';
  }
}

/** Happiness bands, using the shared overlay vocabulary. */
function meterStatus(value: number): 'provided' | 'warn' | 'severe' {
  if (value >= METER_GOOD_AT) return 'provided';
  return value >= METER_WARN_AT ? 'warn' : 'severe';
}
