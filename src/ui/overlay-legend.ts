import { overlayStatusCss } from '../rendering/overlay-semantics';
import type { OverlayName } from './hud';
import { HUD_COMPACT_PANEL_CHROME_CSS } from './hud-style';

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

const NEUTRAL = overlayStatusCss('neutral');
const REACH = overlayStatusCss('reach');
const PROVIDED = overlayStatusCss('provided');
const SOURCE = overlayStatusCss('source');
const WARN = overlayStatusCss('warn');
const SEVERE = overlayStatusCss('severe');

/** Every utility overlay reads the same way, so its key is built the same way. */
function utilityLegend(
  title: string,
  network: string,
  served: string,
  missing: string,
): OverlayLegend {
  return {
    title,
    items: [
      { color: SOURCE, label: network },
      { color: PROVIDED, label: served },
      { color: REACH, label: 'In reach' },
      { color: WARN, label: missing },
      { color: SEVERE, label: 'Failing' },
    ],
  };
}

/** Coverage overlays never alarm — absence costs land value, nothing more. */
function coverageLegend(title: string): OverlayLegend {
  return {
    title,
    items: [
      { color: PROVIDED, label: 'Covered' },
      { color: NEUTRAL, label: 'Not covered' },
    ],
  };
}

/**
 * Colour key shown while a map overlay is active. Swatches come from the
 * shared status palette (rendering/overlay-semantics.ts), so the key cannot
 * drift from what is actually drawn — the whole point of one colour language:
 * grey is "nothing to report", green "provided", yellow "under-served", red
 * "failing". Traffic keeps its own four-step congestion ramp, which already
 * runs green→red in the same spirit.
 */
const OVERLAY_LEGENDS: Partial<Record<OverlayName, OverlayLegend>> = {
  pollution: {
    title: 'Pollution',
    items: [
      { color: NEUTRAL, label: 'Clean' },
      { color: WARN, label: 'Polluted' },
      { color: SEVERE, label: 'Choking' },
    ],
  },
  noise: {
    title: 'Noise',
    items: [
      { color: NEUTRAL, label: 'Quiet' },
      { color: WARN, label: 'Noisy' },
      { color: SEVERE, label: 'Deafening' },
    ],
  },
  landValue: {
    title: 'Land value',
    items: [
      { color: PROVIDED, label: 'High' },
      { color: WARN, label: 'Fair' },
      { color: SEVERE, label: 'Low' },
    ],
  },
  traffic: {
    title: 'Traffic',
    items: [
      { color: '#69a869', label: 'Flowing' },
      { color: '#e3cf4a', label: 'Busy' },
      { color: '#f2953b', label: 'Heavy' },
      { color: '#e0453a', label: 'Jammed' },
    ],
  },
  power: utilityLegend('Power', 'Plants & lines', 'Powered', 'No power'),
  water: utilityLegend('Water', 'Pumps & pipes', 'Watered', 'No water'),
  fireCoverage: coverageLegend('Fire cover'),
  policeCoverage: coverageLegend('Police cover'),
  healthCoverage: coverageLegend('Health cover'),
  educationCoverage: coverageLegend('Education'),
};

/**
 * Colour-key panel for the active map overlay. Bottom-left and absolutely
 * positioned — it can never displace the top HUD bar. It sits just above the
 * camera hint, but hops above the inspect panel when one is open (both share
 * the bottom-left corner).
 */
export class OverlayLegendView {
  private readonly el: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:absolute;bottom:36px;left:12px;min-width:104px;font-size:12px;padding:7px 10px;' +
      `user-select:none;pointer-events:none;z-index:9;display:none;${HUD_COMPACT_PANEL_CHROME_CSS}`;
    container.appendChild(this.el);
  }

  /** Shows the key for the active overlay (or hides it for 'none'). */
  render(overlay: OverlayName, inspectOpen: boolean): void {
    const spec = OVERLAY_LEGENDS[overlay];
    if (!spec) {
      this.el.style.display = 'none';
      return;
    }
    this.el.replaceChildren();
    this.el.style.bottom = inspectOpen ? '180px' : '36px';
    this.el.style.display = 'block';
    const title = document.createElement('div');
    title.textContent = spec.title;
    title.style.cssText = 'font-weight:bold;margin-bottom:5px';
    this.el.appendChild(title);
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
      this.el.append(bar, ends);
    } else if (spec.items) {
      for (const item of spec.items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:7px;line-height:1.5';
        const swatch = document.createElement('span');
        swatch.style.cssText = `width:12px;height:12px;border-radius:2px;flex:none;background:${item.color}`;
        const label = document.createElement('span');
        label.textContent = item.label;
        row.append(swatch, label);
        this.el.appendChild(row);
      }
    }
  }
}
