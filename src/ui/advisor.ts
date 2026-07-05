/** One checklist requirement inside a tip, with its live completion state. */
export interface TipStep {
  text: string;
  done: boolean;
}

/** A prioritized advisory computed by the app layer. */
export interface Advisory {
  /** Stable problem-type key. */
  id: string;
  text: string;
  /** World cell to fly to when the row is clicked. */
  target?: { x: number; y: number };
  /**
   * Checklist requirements. A tip with steps is a guided task: done steps get a
   * green check, and it stays expanded (no dismiss) until every step is done —
   * the app drops it from the list once complete, so it only ever collapses
   * after all requirements are satisfied.
   */
  steps?: TipStep[];
}

/** Serializes an advisory's visible content so the panel re-renders on any change. */
function signature(advisory: Advisory): string {
  const steps = advisory.steps?.map((s) => (s.done ? '1' : '0')).join('') ?? '';
  return `${advisory.id}|${advisory.text}|${advisory.target ? 'T' : ''}|${steps}`;
}

/**
 * Bottom-right advisor panel: persistent, scrollable. Plain advisories are
 * per-row dismissable and fly the camera to the problem when clicked. Tips
 * (advisories with steps) render as a live checklist — each satisfied
 * requirement shows a green check, and the tip cannot be dismissed until every
 * requirement is met (the app removes it once complete).
 */
export class AdvisorPanel {
  private readonly root: HTMLDivElement;
  private readonly countEl: HTMLSpanElement;
  private readonly listEl: HTMLDivElement;
  private readonly collapseButton: HTMLButtonElement;
  private advisories: Advisory[] = [];
  private readonly dismissed = new Set<string>();
  private collapsed = false;

  constructor(
    container: HTMLElement,
    private readonly onFocus: (target: { x: number; y: number }) => void,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;bottom:14px;right:14px;width:360px;max-width:46vw;color:#fff;' +
      'background:rgba(10,20,30,.82);border:1px solid rgba(143,224,255,.25);border-radius:8px;' +
      'font-size:12.5px;z-index:10;user-select:none;display:none;overflow:hidden';

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(83,193,232,.12);' +
      'font-weight:bold;cursor:pointer';
    const title = document.createElement('span');
    title.textContent = '💡 Advisor';
    this.countEl = document.createElement('span');
    this.countEl.style.cssText = 'color:#8fb3c9;font-weight:normal;font-size:11px;flex:1';
    this.collapseButton = document.createElement('button');
    this.collapseButton.style.cssText =
      'background:none;border:none;color:#8fe0ff;cursor:pointer;font-size:13px;padding:0 2px';
    header.appendChild(title);
    header.appendChild(this.countEl);
    header.appendChild(this.collapseButton);
    header.addEventListener('click', () => {
      // A tip with unmet requirements pins the panel open — you cannot collapse
      // guidance away until every requirement is checked off.
      if (this.hasBlockingTip()) return;
      this.collapsed = !this.collapsed;
      this.render();
    });

    this.listEl = document.createElement('div');
    this.listEl.style.cssText = 'max-height:260px;overflow-y:auto;padding:4px 0';

    this.root.appendChild(header);
    this.root.appendChild(this.listEl);
    container.appendChild(this.root);
  }

  /** Replaces the advisory list (already prioritized). */
  update(advisories: Advisory[]): void {
    const changed =
      advisories.length !== this.advisories.length ||
      advisories.some((a, i) => signature(a) !== signature(this.advisories[i] ?? { id: '', text: '' }));
    this.advisories = advisories;
    for (const text of this.dismissed) {
      if (!advisories.some((a) => a.text === text)) this.dismissed.delete(text);
    }
    if (changed) this.render();
  }

  /** Currently visible advisory texts (exposed for the automation text state). */
  current(): readonly string[] {
    return this.advisories.filter((a) => !this.dismissed.has(a.text)).map((a) => a.text);
  }

  /** A tip (advisory with steps) still has at least one unmet requirement. */
  private hasBlockingTip(): boolean {
    return this.advisories.some((a) => a.steps?.some((s) => !s.done) ?? false);
  }

  private render(): void {
    const visible = this.advisories.filter((a) => !this.dismissed.has(a.text));
    if (visible.length === 0) {
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = 'block';
    this.countEl.textContent = `${visible.length} item${visible.length === 1 ? '' : 's'}`;
    // An unmet tip pins the panel open and hides the collapse affordance.
    const blocking = this.hasBlockingTip();
    if (blocking) this.collapsed = false;
    this.collapseButton.style.display = blocking ? 'none' : '';
    this.collapseButton.textContent = this.collapsed ? '▸' : '▾';
    this.listEl.style.display = this.collapsed ? 'none' : 'block';
    if (this.collapsed) return;

    this.listEl.textContent = '';
    for (const advisory of visible) this.listEl.appendChild(this.buildRow(advisory));
  }

  private buildRow(advisory: Advisory): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.06)';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:flex-start;gap:6px;line-height:1.35';
    const message = document.createElement('span');
    message.textContent = advisory.target ? `${advisory.text} 📍` : advisory.text;
    message.style.flex = '1';
    if (advisory.target) {
      message.style.cursor = 'pointer';
      message.title = 'Click to jump to the problem';
      const target = advisory.target;
      message.addEventListener('click', () => this.onFocus(target));
    }
    top.appendChild(message);
    // A tip stays until every requirement is met, so it has no dismiss button;
    // plain advisories can be dismissed (they return if the situation persists).
    if (!advisory.steps) top.appendChild(this.dismissButton(advisory));
    row.appendChild(top);

    if (advisory.steps) row.appendChild(this.buildChecklist(advisory.steps));
    return row;
  }

  private dismissButton(advisory: Advisory): HTMLButtonElement {
    const dismiss = document.createElement('button');
    dismiss.textContent = '×';
    dismiss.title = 'Dismiss (returns if the situation persists)';
    dismiss.style.cssText =
      'background:none;border:none;color:#8fb3c9;cursor:pointer;font-size:14px;padding:0 2px;line-height:1';
    dismiss.addEventListener('click', (event) => {
      event.stopPropagation();
      this.dismissed.add(advisory.text);
      this.render();
    });
    return dismiss;
  }

  /** Checklist: each requirement with a green ✓ when done, a hollow marker while pending. */
  private buildChecklist(steps: readonly TipStep[]): HTMLDivElement {
    const list = document.createElement('div');
    list.style.cssText = 'margin:5px 0 2px;display:flex;flex-direction:column;gap:3px';
    for (const step of steps) {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:1.4';
      const mark = document.createElement('span');
      mark.textContent = step.done ? '✓' : '○';
      mark.style.cssText = `flex:none;font-weight:bold;color:${step.done ? '#5fe07a' : '#7f97a8'}`;
      const label = document.createElement('span');
      label.textContent = step.text;
      label.style.cssText = `flex:1;color:${step.done ? '#8fb3c9' : '#cfe6f2'}${step.done ? ';text-decoration:line-through' : ''}`;
      item.appendChild(mark);
      item.appendChild(label);
      list.appendChild(item);
    }
    return list;
  }
}
