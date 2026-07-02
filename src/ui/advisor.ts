/**
 * Bottom-right advisor panel: a persistent, scrollable list of everything the
 * city currently lacks or that is going wrong, in priority order. Each row is
 * dismissable; a dismissed advisory stays hidden until its text changes
 * (e.g. "3 buildings lack power" → "5 buildings lack power" reappears).
 * Purely presentational; the app layer computes the advisory list.
 */
export class AdvisorPanel {
  private readonly root: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly countEl: HTMLSpanElement;
  private readonly listEl: HTMLDivElement;
  private readonly collapseButton: HTMLButtonElement;
  private advisories: string[] = [];
  private readonly dismissed = new Set<string>();
  private collapsed = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;bottom:14px;right:14px;width:340px;max-width:44vw;color:#fff;' +
      'background:rgba(10,20,30,.82);border:1px solid rgba(143,224,255,.25);border-radius:8px;' +
      'font-size:12.5px;z-index:10;user-select:none;display:none;overflow:hidden';

    this.header = document.createElement('div');
    this.header.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(83,193,232,.12);' +
      'font-weight:bold;cursor:pointer';
    const title = document.createElement('span');
    title.textContent = '💡 Advisor';
    this.countEl = document.createElement('span');
    this.countEl.style.cssText = 'color:#8fb3c9;font-weight:normal;font-size:11px;flex:1';
    this.collapseButton = document.createElement('button');
    this.collapseButton.style.cssText =
      'background:none;border:none;color:#8fe0ff;cursor:pointer;font-size:13px;padding:0 2px';
    this.header.appendChild(title);
    this.header.appendChild(this.countEl);
    this.header.appendChild(this.collapseButton);
    this.header.addEventListener('click', () => this.toggleCollapsed());

    this.listEl = document.createElement('div');
    this.listEl.style.cssText = 'max-height:170px;overflow-y:auto;padding:4px 0';

    this.root.appendChild(this.header);
    this.root.appendChild(this.listEl);
    container.appendChild(this.root);
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.render();
  }

  /** Replaces the advisory list (already prioritized). */
  update(advisories: string[]): void {
    const changed =
      advisories.length !== this.advisories.length ||
      advisories.some((a, i) => a !== this.advisories[i]);
    this.advisories = advisories;
    // Forget dismissals whose advisory is gone, so a future recurrence shows.
    for (const text of this.dismissed) {
      if (!advisories.includes(text)) this.dismissed.delete(text);
    }
    if (changed) this.render();
  }

  /** Currently visible advisories (exposed for the automation text state). */
  current(): readonly string[] {
    return this.advisories.filter((a) => !this.dismissed.has(a));
  }

  private render(): void {
    const visible = this.current();
    if (visible.length === 0) {
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = 'block';
    this.countEl.textContent = `${visible.length} item${visible.length === 1 ? '' : 's'}`;
    this.collapseButton.textContent = this.collapsed ? '▸' : '▾';
    this.listEl.style.display = this.collapsed ? 'none' : 'block';
    if (this.collapsed) return;

    this.listEl.textContent = '';
    for (const text of visible) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:flex-start;gap:6px;padding:5px 10px;line-height:1.35;' +
        'border-bottom:1px solid rgba(255,255,255,.06)';
      const message = document.createElement('span');
      message.textContent = text;
      message.style.flex = '1';
      const dismiss = document.createElement('button');
      dismiss.textContent = '×';
      dismiss.title = 'Dismiss (returns if the situation changes)';
      dismiss.style.cssText =
        'background:none;border:none;color:#8fb3c9;cursor:pointer;font-size:14px;padding:0 2px;line-height:1';
      dismiss.addEventListener('click', (event) => {
        event.stopPropagation();
        this.dismissed.add(text);
        this.render();
      });
      row.appendChild(message);
      row.appendChild(dismiss);
      this.listEl.appendChild(row);
    }
  }
}
