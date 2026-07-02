const ROTATE_MS = 4500;

/**
 * Bottom-center rolling banner cycling through active advisories — what the
 * city lacks or what's going wrong, in priority order. Purely presentational;
 * the app layer computes the advisory list.
 */
export class AdvisorBanner {
  private readonly root: HTMLDivElement;
  private readonly textEl: HTMLSpanElement;
  private readonly counterEl: HTMLSpanElement;
  private advisories: string[] = [];
  private index = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;bottom:14px;left:50%;transform:translateX(-50%);max-width:60%;' +
      'color:#fff;background:rgba(10,20,30,.78);padding:7px 14px;border-radius:8px;' +
      'font-size:13px;display:none;align-items:center;gap:10px;z-index:10;' +
      'border:1px solid rgba(143,224,255,.25);user-select:none';

    this.textEl = document.createElement('span');
    this.counterEl = document.createElement('span');
    this.counterEl.style.cssText = 'color:#8fb3c9;font-size:11px;white-space:nowrap';
    this.root.appendChild(this.textEl);
    this.root.appendChild(this.counterEl);
    container.appendChild(this.root);

    setInterval(() => {
      if (this.advisories.length > 1) {
        this.index = (this.index + 1) % this.advisories.length;
        this.render();
      }
    }, ROTATE_MS);
  }

  /** Replaces the advisory list; keeps rotation position when unchanged. */
  update(advisories: string[]): void {
    const changed =
      advisories.length !== this.advisories.length ||
      advisories.some((a, i) => a !== this.advisories[i]);
    this.advisories = advisories;
    if (changed) this.index = 0;
    this.render();
  }

  /** Current advisory list (exposed for the automation text state). */
  current(): readonly string[] {
    return this.advisories;
  }

  private render(): void {
    if (this.advisories.length === 0) {
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = 'flex';
    this.index = Math.min(this.index, this.advisories.length - 1);
    this.textEl.textContent = this.advisories[this.index];
    this.counterEl.textContent = this.advisories.length > 1 ? `${this.index + 1}/${this.advisories.length}` : '';
  }
}
