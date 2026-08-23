import {
  HUD_DIVIDER_COLOR,
  HUD_MUTED_TEXT,
  HUD_NEGATIVE_TEXT,
  HUD_PANEL_CHROME_CSS,
  hudButtonCss,
  hudIconButtonCss,
} from './hud-style';
import { MeterView, type InspectMeter } from './inspect-meter';

export type { InspectMeter } from './inspect-meter';

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

/** A visually separated, individually expandable group within an inspector. */
export interface InspectSection {
  /**
   * Stable collapse-state key. Headings carry live counts ("Members (3)"), so
   * keying on the heading alone would silently reopen a section the player
   * closed the moment its count changed — always give a section an id.
   */
  id?: string;
  heading: string;
  lines: string[];
  /** Bars rendered above the lines, e.g. occupancy or level progress. */
  meters?: InspectMeter[];
  /** One-line gist shown on the header row, readable while collapsed. */
  summary?: string;
  /** Default false: sections open unless a section asks to start closed. */
  startCollapsed?: boolean;
  /** Default true. A pinned section renders as a plain heading with no control. */
  collapsible?: boolean;
}

/** Collapse-state key for one section (see `InspectSection.id`). */
export function inspectSectionKey(section: InspectSection): string {
  return section.id ?? section.heading;
}

/**
 * Whether a section is expanded right now: the player's own toggle wins, and
 * until they touch it the section's own default applies. Kept separate from the
 * DOM so the "a live refresh must not reopen what I closed" rule is testable.
 */
export function inspectSectionOpen(
  section: InspectSection,
  toggles: ReadonlyMap<string, boolean>,
): boolean {
  if (section.collapsible === false) return true;
  const toggled = toggles.get(inspectSectionKey(section));
  return toggled ?? !(section.startCollapsed ?? false);
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
  /** Flat fallback used by simple panels and text-oriented consumers. */
  lines: string[];
  /** Optional hierarchy for richer citizen and building details. */
  sections?: InspectSection[];
  /** Optional building/resident navigation supplied by the app controller. */
  actions?: InspectAction[];
  abandoned: boolean;
  /** Optional subtitle under the title, e.g. "Level 2 · 2×2 at (14, 30)". */
  subtitle?: string;
  /** Optional headline bar shown above the details (people show happiness). */
  meter?: InspectMeter;
}

/** Reused DOM for one section, so a refresh never rebuilds under the pointer. */
interface SectionView {
  root: HTMLElement;
  header: HTMLButtonElement;
  headingEl: HTMLSpanElement;
  summaryEl: HTMLSpanElement;
  caretEl: HTMLSpanElement;
  body: HTMLDivElement;
  meterHost: HTMLDivElement;
  meters: MeterView[];
  lineHost: HTMLDivElement;
  lineEls: HTMLDivElement[];
}

/** Bottom-left selection inspector for buildings, structures, and citizens. */
export class InspectPanel {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly badgeEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly actionsEl: HTMLDivElement;
  private readonly meterEl: MeterView;
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly sectionViews = new Map<string, SectionView>();
  /** Player-toggled sections for the CURRENT subject only. */
  private readonly sectionToggles = new Map<string, boolean>();
  private lineViews: HTMLDivElement[] = [];
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

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.style.cssText =
      `margin-top:2px;color:${HUD_MUTED_TEXT};font-size:12px;line-height:1.3;display:none`;
    this.root.appendChild(this.subtitleEl);

    this.badgeEl = document.createElement('div');
    this.badgeEl.textContent = 'Abandoned';
    this.badgeEl.style.cssText =
      `color:${HUD_NEGATIVE_TEXT};font-weight:bold;margin-top:4px;display:none`;
    this.root.appendChild(this.badgeEl);

    this.meterEl = new MeterView();
    this.meterEl.root.style.cssText = 'margin-top:9px;display:none';
    this.root.appendChild(this.meterEl.root);

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText =
      'margin-top:8px;display:flex;flex-direction:column;gap:2px;line-height:1.35';
    this.root.appendChild(this.bodyEl);

    this.actionsEl = document.createElement('div');
    this.actionsEl.style.cssText =
      `margin-top:10px;padding-top:9px;border-top:1px solid ${HUD_DIVIDER_COLOR};display:none;gap:7px;flex-wrap:wrap`;
    this.root.appendChild(this.actionsEl);

    this.container.appendChild(this.root);
  }

  show(data: InspectData): void {
    const resetScroll = inspectPanelShouldResetScroll(this.subjectKey, data.subjectKey);
    // Expansion belongs to the thing being looked at: a new subject starts from
    // its own defaults, while a live refresh of the same subject must leave the
    // player's open/closed choices exactly where they left them.
    if (resetScroll) this.sectionToggles.clear();
    this.subjectKey = data.subjectKey;
    this.titleEl.textContent = data.title;
    this.subtitleEl.textContent = data.subtitle ?? '';
    this.subtitleEl.style.display = data.subtitle ? 'block' : 'none';
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
    this.sectionToggles.clear();
  }

  private renderBody(data: InspectData): void {
    const sections = data.sections ?? [];
    if (sections.length === 0) {
      this.clearSections();
      this.renderFlatLines(data.lines);
      return;
    }
    this.renderFlatLines([]);
    const live = new Set<string>();
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index];
      const key = inspectSectionKey(section);
      live.add(key);
      const view = this.sectionView(key);
      this.updateSection(view, section, key);
      // Only MOVE a section that is actually out of position. Re-appending an
      // in-place node still detaches it, which blurs a focused header button —
      // and this panel refreshes twice a second while a subject is open.
      const atIndex = this.bodyEl.children[index];
      if (atIndex !== view.root) this.bodyEl.insertBefore(view.root, atIndex ?? null);
    }
    for (const [key, view] of [...this.sectionViews]) {
      if (live.has(key)) continue;
      view.root.remove();
      this.sectionViews.delete(key);
    }
  }

  /** Flat-line mode for simple panels; reuses rows to avoid churn. */
  private renderFlatLines(lines: string[]): void {
    while (this.lineViews.length > lines.length) this.lineViews.pop()!.remove();
    while (this.lineViews.length < lines.length) {
      const row = this.line();
      this.lineViews.push(row);
      this.bodyEl.appendChild(row);
    }
    for (let i = 0; i < lines.length; i++) this.lineViews[i].textContent = lines[i];
  }

  private clearSections(): void {
    for (const view of this.sectionViews.values()) view.root.remove();
    this.sectionViews.clear();
  }

  private sectionView(key: string): SectionView {
    const existing = this.sectionViews.get(key);
    if (existing) return existing;

    const root = document.createElement('section');
    root.style.cssText = 'margin-top:7px';
    const header = document.createElement('button');
    header.type = 'button';
    header.style.cssText =
      `width:100%;display:flex;align-items:baseline;gap:6px;padding:6px 0 0;` +
      `border:0;border-top:1px solid ${HUD_DIVIDER_COLOR};background:none;cursor:pointer;` +
      `color:${HUD_MUTED_TEXT};font:inherit;text-align:left`;
    const caretEl = document.createElement('span');
    caretEl.setAttribute('aria-hidden', 'true');
    caretEl.style.cssText = 'flex:0 0 auto;font-size:10px;line-height:1.6';
    const headingEl = document.createElement('span');
    headingEl.setAttribute('role', 'heading');
    headingEl.setAttribute('aria-level', '3');
    headingEl.style.cssText =
      'font-size:11px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase';
    const summaryEl = document.createElement('span');
    summaryEl.style.cssText =
      'margin-left:auto;font-size:11px;text-align:right;overflow-wrap:anywhere';
    header.append(caretEl, headingEl, summaryEl);

    const body = document.createElement('div');
    body.style.cssText = 'margin-top:3px;display:flex;flex-direction:column;gap:5px';
    const meterHost = document.createElement('div');
    meterHost.style.cssText = 'display:flex;flex-direction:column;gap:5px';
    const lineHost = document.createElement('div');
    lineHost.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    body.append(meterHost, lineHost);
    root.append(header, body);

    const view: SectionView = {
      root,
      header,
      headingEl,
      summaryEl,
      caretEl,
      body,
      meterHost,
      meters: [],
      lineHost,
      lineEls: [],
    };
    header.addEventListener('click', () => {
      const open = header.getAttribute('aria-expanded') !== 'true';
      this.sectionToggles.set(key, open);
      this.applySectionOpen(view, open);
    });
    this.sectionViews.set(key, view);
    return view;
  }

  private updateSection(view: SectionView, section: InspectSection, key: string): void {
    view.headingEl.textContent = section.heading;
    view.summaryEl.textContent = section.summary ?? '';
    const collapsible = section.collapsible !== false;
    view.header.disabled = !collapsible;
    view.header.style.cursor = collapsible ? 'pointer' : 'default';
    view.header.setAttribute(
      'aria-label',
      section.summary ? `${section.heading}: ${section.summary}` : section.heading,
    );

    const meters = section.meters ?? [];
    while (view.meters.length > meters.length) view.meters.pop()!.root.remove();
    while (view.meters.length < meters.length) {
      const meter = new MeterView();
      view.meters.push(meter);
      view.meterHost.appendChild(meter.root);
    }
    for (let i = 0; i < meters.length; i++) view.meters[i].update(meters[i]);
    view.meterHost.style.display = meters.length > 0 ? 'flex' : 'none';

    while (view.lineEls.length > section.lines.length) view.lineEls.pop()!.remove();
    while (view.lineEls.length < section.lines.length) {
      const row = this.line();
      view.lineEls.push(row);
      view.lineHost.appendChild(row);
    }
    for (let i = 0; i < section.lines.length; i++) {
      view.lineEls[i].textContent = section.lines[i];
    }
    view.lineHost.style.display = section.lines.length > 0 ? 'flex' : 'none';

    this.applySectionOpen(view, inspectSectionOpen(section, this.sectionToggles), collapsible);
    if (section.collapsible === false) this.sectionToggles.delete(key);
  }

  private applySectionOpen(view: SectionView, open: boolean, collapsible = true): void {
    view.header.setAttribute('aria-expanded', open ? 'true' : 'false');
    view.caretEl.textContent = collapsible ? (open ? '▼' : '▶') : '';
    view.body.style.display = open ? 'flex' : 'none';
    // The summary is the collapsed view of the section. Showing it while the
    // body is open printed the same fact twice in a row on every panel.
    view.summaryEl.style.display = open ? 'none' : 'inline';
  }

  private line(): HTMLDivElement {
    const row = document.createElement('div');
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

  private renderMeter(meter: InspectMeter | undefined): void {
    if (!meter) {
      this.meterEl.root.style.display = 'none';
      return;
    }
    this.meterEl.update(meter);
    this.meterEl.root.style.display = 'block';
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
