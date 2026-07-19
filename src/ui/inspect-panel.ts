import { overlayStatusCss } from '../rendering/overlay-semantics';
import {
  HUD_DIVIDER_COLOR,
  HUD_MUTED_TEXT,
  HUD_NEGATIVE_TEXT,
  HUD_PANEL_CHROME_CSS,
  hudButtonCss,
  hudIconButtonCss,
} from './hud-style';

/** At or above this the bar reads green; below METER_WARN_AT it reads red. */
const METER_GOOD_AT = 0.6;
const METER_WARN_AT = 0.3;

/** Desktop inspector dimensions are exported for a DOM-free layout contract. */
export const INSPECT_PANEL_LAYOUT_CSS =
  'position:absolute;bottom:8px;left:8px;width:380px;max-width:calc(100vw - 16px);' +
  'max-height:calc(100vh - 84px);box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;' +
  `padding:12px 14px;font-size:13px;display:none;user-select:none;z-index:10;${HUD_PANEL_CHROME_CSS}`;

export const INSPECT_PANEL_HUD_GAP_PX = 8;
const INSPECT_PANEL_BOTTOM_PX = 8;

/** Available panel height below a wrapped top HUD inside the game container. */
export function inspectPanelMaxHeight(
  containerTop: number,
  containerBottom: number,
  hudBottom: number,
): number {
  const contentTop = Math.max(containerTop, hudBottom + INSPECT_PANEL_HUD_GAP_PX);
  return Math.max(0, containerBottom - contentTop - INSPECT_PANEL_BOTTOM_PX);
}

/** A new inspected subject starts at its headline; live refreshes retain reading position. */
export function inspectPanelShouldResetScroll(
  previousSubjectKey: string | null,
  nextSubjectKey: string,
): boolean {
  return previousSubjectKey !== nextSubjectKey;
}

/** A labelled 0..1 bar, e.g. a household's happiness. */
export interface InspectMeter {
  label: string;
  /** Clamped to 0..1 by the panel; drives both the bar and its colour. */
  value: number;
  /** Right-hand caption, e.g. "72% — content". */
  caption: string;
}

/** A visually separated group within a rich inspector. */
export interface InspectSection {
  heading: string;
  lines: string[];
}

/** App-owned action. The panel only presents it and invokes its callback. */
export interface InspectAction {
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  primary?: boolean;
}

/** Pre-formatted details (the app layer owns all sim math and wording). */
export interface InspectData {
  /** Stable inspected-object identity; display titles are not necessarily unique. */
  subjectKey: string;
  title: string;
  /** Flat fallback used by simple building panels and text-oriented consumers. */
  lines: string[];
  /** Optional hierarchy for richer citizen details. */
  sections?: InspectSection[];
  /** Optional building/resident navigation supplied by the app controller. */
  actions?: InspectAction[];
  abandoned: boolean;
  /** Optional headline bar shown above the details (people show happiness). */
  meter?: InspectMeter;
}

/** Bottom-left selection inspector for buildings, structures, and citizens. */
export class InspectPanel {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly badgeEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly actionsEl: HTMLDivElement;
  private readonly meterEl: HTMLDivElement;
  private readonly meterLabelEl: HTMLDivElement;
  private readonly meterNameEl: HTMLSpanElement;
  private readonly meterCaptionEl: HTMLSpanElement;
  private readonly meterTrackEl: HTMLDivElement;
  private readonly meterFillEl: HTMLDivElement;
  private readonly actionButtons: HTMLButtonElement[] = [];
  private bodySignature: string | null = null;
  private subjectKey: string | null = null;

  constructor(private readonly container: HTMLElement, onClose: () => void) {
    this.root = document.createElement('div');
    this.root.style.cssText = INSPECT_PANEL_LAYOUT_CSS;
    this.root.setAttribute('role', 'complementary');
    this.root.setAttribute('aria-label', 'Selection details');

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;justify-content:space-between;align-items:flex-start;gap:12px';
    this.titleEl = document.createElement('span');
    this.titleEl.style.cssText =
      'font-weight:bold;font-size:15px;line-height:1.25;overflow-wrap:anywhere';
    header.appendChild(this.titleEl);

    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.title = 'Close inspector';
    closeButton.setAttribute('aria-label', 'Close inspector');
    closeButton.style.cssText = `${hudIconButtonCss()}flex:0 0 auto`;
    closeButton.addEventListener('click', onClose);
    header.appendChild(closeButton);
    this.root.appendChild(header);

    this.badgeEl = document.createElement('div');
    this.badgeEl.textContent = 'Abandoned';
    this.badgeEl.style.cssText =
      `color:${HUD_NEGATIVE_TEXT};font-weight:bold;margin-top:4px;display:none`;
    this.root.appendChild(this.badgeEl);

    this.meterEl = document.createElement('div');
    this.meterEl.style.cssText = 'margin-top:9px;display:none';
    this.meterLabelEl = document.createElement('div');
    this.meterLabelEl.style.cssText =
      'display:flex;justify-content:space-between;gap:10px;font-size:12px;line-height:1.25';
    this.meterNameEl = document.createElement('span');
    this.meterCaptionEl = document.createElement('span');
    this.meterLabelEl.append(this.meterNameEl, this.meterCaptionEl);
    this.meterTrackEl = document.createElement('div');
    this.meterTrackEl.style.cssText =
      'height:8px;margin-top:4px;border-radius:4px;overflow:hidden;background:rgba(20,40,45,.18)';
    this.meterFillEl = document.createElement('div');
    this.meterFillEl.style.cssText = 'height:100%;width:0%';
    this.meterTrackEl.setAttribute('role', 'progressbar');
    this.meterTrackEl.setAttribute('aria-valuemin', '0');
    this.meterTrackEl.setAttribute('aria-valuemax', '100');
    this.meterTrackEl.appendChild(this.meterFillEl);
    this.meterEl.append(this.meterLabelEl, this.meterTrackEl);
    this.root.appendChild(this.meterEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText =
      'margin-top:8px;display:flex;flex-direction:column;gap:9px;line-height:1.35';
    this.root.appendChild(this.bodyEl);

    this.actionsEl = document.createElement('div');
    this.actionsEl.style.cssText =
      `margin-top:10px;padding-top:9px;border-top:1px solid ${HUD_DIVIDER_COLOR};display:none;gap:7px;flex-wrap:wrap`;
    this.root.appendChild(this.actionsEl);

    this.container.appendChild(this.root);
  }

  show(data: InspectData): void {
    const resetScroll = inspectPanelShouldResetScroll(
      this.subjectKey,
      data.subjectKey,
    );
    this.subjectKey = data.subjectKey;
    this.titleEl.textContent = data.title;
    this.badgeEl.style.display = data.abandoned ? 'block' : 'none';
    this.renderMeter(data.meter);
    this.renderBody(data);
    this.renderActions(data.actions);
    this.positionBelowHud();
    this.root.style.display = 'block';
    if (resetScroll) this.root.scrollTop = 0;
  }

  hide(): void {
    this.root.style.display = 'none';
    this.subjectKey = null;
  }

  private renderBody(data: InspectData): void {
    const signature = JSON.stringify(data.sections?.length ? data.sections : data.lines);
    if (signature === this.bodySignature) return;
    this.bodySignature = signature;
    const scrollTop = this.root.scrollTop;
    if (!data.sections || data.sections.length === 0) {
      this.bodyEl.replaceChildren(...data.lines.map((line) => this.line(line)));
      this.root.scrollTop = scrollTop;
      return;
    }
    this.bodyEl.replaceChildren(
      ...data.sections.map((section) => {
        const sectionEl = document.createElement('section');
        const heading = document.createElement('div');
        heading.textContent = section.heading;
        heading.setAttribute('role', 'heading');
        heading.setAttribute('aria-level', '3');
        heading.style.cssText =
          `padding-top:6px;border-top:1px solid ${HUD_DIVIDER_COLOR};color:${HUD_MUTED_TEXT};` +
          'font-size:11px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase';
        const lines = document.createElement('div');
        lines.style.cssText = 'margin-top:3px;display:flex;flex-direction:column;gap:2px';
        lines.replaceChildren(...section.lines.map((line) => this.line(line)));
        sectionEl.append(heading, lines);
        return sectionEl;
      }),
    );
    this.root.scrollTop = scrollTop;
  }

  private line(text: string): HTMLDivElement {
    const row = document.createElement('div');
    row.textContent = text;
    row.style.cssText = 'overflow-wrap:anywhere';
    return row;
  }

  private renderActions(actions: InspectAction[] | undefined): void {
    const next = actions ?? [];
    while (this.actionButtons.length > next.length) {
      this.actionButtons.pop()!.remove();
    }
    while (this.actionButtons.length < next.length) {
      const button = document.createElement('button');
      button.type = 'button';
      this.actionButtons.push(button);
      this.actionsEl.appendChild(button);
    }
    if (next.length === 0) {
      this.actionsEl.style.display = 'none';
      return;
    }
    for (let index = 0; index < next.length; index++) {
      const action = next[index];
      const button = this.actionButtons[index];
      button.textContent = action.label;
      button.disabled = action.disabled ?? false;
      button.title = action.title ?? '';
      button.style.cssText = hudButtonCss(action.primary ?? false);
      if (button.disabled) {
        button.style.cursor = 'not-allowed';
        button.style.opacity = '0.55';
      }
      button.onclick = action.onClick;
    }
    this.actionsEl.style.display = 'flex';
  }

  /** Fills the meter using the shared overlay status colours. */
  private renderMeter(meter: InspectMeter | undefined): void {
    if (!meter) {
      this.meterEl.style.display = 'none';
      return;
    }
    const value = Math.min(Math.max(meter.value, 0), 1);
    this.meterNameEl.textContent = meter.label;
    this.meterCaptionEl.textContent = meter.caption;
    this.meterFillEl.style.width = `${Math.round(value * 100)}%`;
    this.meterFillEl.style.background = overlayStatusCss(meterStatus(value));
    this.meterTrackEl.setAttribute('aria-label', meter.label);
    this.meterTrackEl.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    this.meterTrackEl.setAttribute('aria-valuetext', meter.caption);
    this.meterEl.style.display = 'block';
  }

  private positionBelowHud(): void {
    const hud = this.container.querySelector<HTMLElement>('[data-city-hud="top"]');
    if (!hud) return;
    const containerRect = this.container.getBoundingClientRect();
    const hudRect = hud.getBoundingClientRect();
    this.root.style.maxHeight = `${inspectPanelMaxHeight(
      containerRect.top,
      containerRect.bottom,
      hudRect.bottom,
    )}px`;
  }
}

/** Happiness bands, using the shared overlay vocabulary. */
function meterStatus(value: number): 'provided' | 'warn' | 'severe' {
  if (value >= METER_GOOD_AT) return 'provided';
  return value >= METER_WARN_AT ? 'warn' : 'severe';
}
