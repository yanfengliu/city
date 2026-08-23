import { overlayStatusCss } from '../rendering/overlay-semantics';

/** At or above this the bar reads green; below METER_WARN_AT it reads red. */
export const METER_GOOD_AT = 0.6;
export const METER_WARN_AT = 0.3;

/** A labelled 0..1 bar, e.g. a household's happiness or a building's occupancy. */
export interface InspectMeter {
  label: string;
  /** Clamped to 0..1 by the panel; drives both the bar and its colour. */
  value: number;
  /** Right-hand caption, e.g. "72% — content". */
  caption: string;
  /**
   * Inverts the colour ramp for nuisances (pollution, abandonment risk) where a
   * FULL bar is the bad news. The bar length still tracks `value`.
   */
  worseWhenFull?: boolean;
}

/** Bands shared with the overlay vocabulary, so panels and maps agree. */
export function meterStatus(
  value: number,
  worseWhenFull = false,
): 'provided' | 'warn' | 'severe' {
  const good = worseWhenFull ? 1 - value : value;
  if (good >= METER_GOOD_AT) return 'provided';
  return good >= METER_WARN_AT ? 'warn' : 'severe';
}

/**
 * One reusable bar. Kept as an object with its own nodes so a live-refreshing
 * panel updates text and width in place instead of rebuilding DOM under the
 * player's pointer.
 */
export class MeterView {
  readonly root: HTMLDivElement;
  private readonly nameEl: HTMLSpanElement;
  private readonly captionEl: HTMLSpanElement;
  private readonly trackEl: HTMLDivElement;
  private readonly fillEl: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.style.cssText =
      'display:flex;justify-content:space-between;gap:10px;font-size:12px;line-height:1.25';
    this.nameEl = document.createElement('span');
    this.captionEl = document.createElement('span');
    this.captionEl.style.cssText = 'text-align:right;overflow-wrap:anywhere';
    labelEl.append(this.nameEl, this.captionEl);
    this.trackEl = document.createElement('div');
    this.trackEl.style.cssText =
      'height:8px;margin-top:4px;border-radius:4px;overflow:hidden;background:rgba(20,40,45,.18)';
    this.fillEl = document.createElement('div');
    this.fillEl.style.cssText = 'height:100%;width:0%';
    this.trackEl.setAttribute('role', 'progressbar');
    this.trackEl.setAttribute('aria-valuemin', '0');
    this.trackEl.setAttribute('aria-valuemax', '100');
    this.trackEl.appendChild(this.fillEl);
    this.root.append(labelEl, this.trackEl);
  }

  update(meter: InspectMeter): void {
    const value = Math.min(Math.max(meter.value, 0), 1);
    this.nameEl.textContent = meter.label;
    this.captionEl.textContent = meter.caption;
    this.fillEl.style.width = `${Math.round(value * 100)}%`;
    this.fillEl.style.background = overlayStatusCss(
      meterStatus(value, meter.worseWhenFull ?? false),
    );
    this.trackEl.setAttribute('aria-label', meter.label);
    this.trackEl.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    this.trackEl.setAttribute('aria-valuetext', meter.caption);
  }
}
