import { MAX_TAX_RATE, MIN_TAX_RATE } from '../sim/constants/economy';
import { DEFAULT_TAX_RATE } from '../sim/constants/zoning';
import type { BudgetReport, TaxRates, ZoneType } from '../sim/types';

const ZONE_ROWS: { zone: ZoneType; key: keyof TaxRates; label: string; color: string }[] = [
  { zone: 'R', key: 'r', label: 'Residential', color: '#58c15c' },
  { zone: 'C', key: 'c', label: 'Commercial', color: '#5b8fdd' },
  { zone: 'I', key: 'i', label: 'Industrial', color: '#e09b3d' },
];

function money(value: number): string {
  const rounded = Math.round(value);
  return `$${Math.abs(rounded).toLocaleString('en-US')}`;
}

/**
 * Top-right budget panel: last interval's income/expenses/net plus per-zone
 * tax sliders (0–20%, default 9%). Purely presentational — slider changes
 * dispatch the callback; authoritative rates come back via update() from the
 * sim's frame stats, so a rejected command self-corrects.
 */
export class BudgetPanel {
  private readonly root: HTMLDivElement;
  private readonly incomeEl: HTMLSpanElement;
  private readonly expensesEl: HTMLSpanElement;
  private readonly netEl: HTMLSpanElement;
  private readonly sliders = new Map<keyof TaxRates, HTMLInputElement>();
  private readonly valueEls = new Map<keyof TaxRates, HTMLSpanElement>();

  constructor(container: HTMLElement, onSetTaxRate: (zone: ZoneType, rate: number) => void) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;top:56px;right:8px;width:230px;color:#fff;' +
      'background:rgba(10,20,30,.85);padding:10px 12px;border-radius:8px;font-size:13px;' +
      'display:none;user-select:none;z-index:10';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
    const title = document.createElement('span');
    title.textContent = '💰 Budget';
    title.style.fontWeight = 'bold';
    header.appendChild(title);
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText =
      'background:none;border:none;color:#9db4c8;cursor:pointer;font-size:16px;' +
      'line-height:1;padding:0 2px';
    closeButton.addEventListener('click', () => this.hide());
    header.appendChild(closeButton);
    this.root.appendChild(header);

    const report = document.createElement('div');
    report.style.cssText = 'margin-top:6px;display:flex;flex-direction:column;gap:2px';
    const mkLine = (label: string): HTMLSpanElement => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between';
      const name = document.createElement('span');
      name.textContent = label;
      name.style.color = '#c9d4dd';
      const value = document.createElement('span');
      row.appendChild(name);
      row.appendChild(value);
      report.appendChild(row);
      return value;
    };
    this.incomeEl = mkLine('Income / interval');
    this.expensesEl = mkLine('Expenses / interval');
    this.netEl = mkLine('Net');
    this.root.appendChild(report);

    const taxTitle = document.createElement('div');
    taxTitle.textContent = `Tax rates (default ${DEFAULT_TAX_RATE}%)`;
    taxTitle.style.cssText = 'margin-top:8px;font-weight:bold';
    taxTitle.title = 'Rates above the default reduce demand and building desirability';
    this.root.appendChild(taxTitle);

    for (const row of ZONE_ROWS) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:4px';
      const labelRow = document.createElement('div');
      labelRow.style.cssText = 'display:flex;justify-content:space-between;font-size:12px';
      const name = document.createElement('span');
      name.textContent = row.label;
      name.style.color = row.color;
      const value = document.createElement('span');
      labelRow.appendChild(name);
      labelRow.appendChild(value);
      wrap.appendChild(labelRow);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(MIN_TAX_RATE);
      slider.max = String(MAX_TAX_RATE);
      slider.step = '1';
      slider.value = String(DEFAULT_TAX_RATE);
      slider.style.cssText = 'width:100%;margin:2px 0;accent-color:' + row.color;
      slider.addEventListener('input', () => {
        value.textContent = `${slider.value}%`;
        onSetTaxRate(row.zone, Number(slider.value));
      });
      wrap.appendChild(slider);
      this.root.appendChild(wrap);
      this.sliders.set(row.key, slider);
      this.valueEls.set(row.key, value);
    }

    container.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  toggle(): void {
    this.root.style.display = this.visible ? 'none' : 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /** Syncs sliders and totals with authoritative sim state (skips a slider mid-drag). */
  update(taxRates: TaxRates, budget: BudgetReport): void {
    if (!this.visible) return;
    this.incomeEl.textContent = money(budget.income);
    this.incomeEl.style.color = '#9fdf9f';
    this.expensesEl.textContent = money(budget.expenses);
    this.expensesEl.style.color = '#ff9d9d';
    const net = budget.income - budget.expenses;
    this.netEl.textContent = `${net < 0 ? '−' : '+'}${money(net)}`;
    this.netEl.style.color = net < 0 ? '#ff9d9d' : '#9fdf9f';
    for (const row of ZONE_ROWS) {
      const slider = this.sliders.get(row.key);
      const value = this.valueEls.get(row.key);
      if (!slider || !value) continue;
      if (document.activeElement !== slider) slider.value = String(taxRates[row.key]);
      value.textContent = `${slider.value}%`;
    }
  }
}
