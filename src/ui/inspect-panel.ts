/** Pre-formatted building details (the app layer owns all sim math and wording). */
export interface InspectData {
  /** e.g. "Residential — Level 2". */
  title: string;
  /** Detail lines, e.g. "Footprint: 2×2 cells", "Residents: 9 / 12 people". */
  lines: string[];
  abandoned: boolean;
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

  constructor(container: HTMLElement, onClose: () => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;bottom:8px;left:8px;min-width:190px;color:#fff;' +
      'background:rgba(10,20,30,.85);padding:10px 12px;border-radius:8px;font-size:13px;' +
      'display:none;user-select:none;z-index:10';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px';
    this.titleEl = document.createElement('span');
    this.titleEl.style.cssText = 'font-weight:bold';
    header.appendChild(this.titleEl);

    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText =
      'background:none;border:none;color:#9db4c8;cursor:pointer;font-size:16px;' +
      'line-height:1;padding:0 2px';
    closeButton.addEventListener('click', onClose);
    header.appendChild(closeButton);
    this.root.appendChild(header);

    this.badgeEl = document.createElement('div');
    this.badgeEl.textContent = 'Abandoned';
    this.badgeEl.style.cssText = 'color:#ff9d9d;font-weight:bold;margin-top:4px;display:none';
    this.root.appendChild(this.badgeEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText = 'margin-top:6px;display:flex;flex-direction:column;gap:2px';
    this.root.appendChild(this.bodyEl);

    container.appendChild(this.root);
  }

  show(data: InspectData): void {
    this.titleEl.textContent = data.title;
    this.badgeEl.style.display = data.abandoned ? 'block' : 'none';
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
}
