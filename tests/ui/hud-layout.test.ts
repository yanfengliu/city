import { describe, expect, it } from 'vitest';

import { CITY_TITLES } from '../../src/app/milestones';
import { STAT_SLOT_CH } from '../../src/ui/hud';
import {
  HUD_TOP_BAR_LAYOUT_CSS,
  hudButtonCss,
  hudStatSlotCss,
  hudWarningBadgeCss,
} from '../../src/ui/hud-style';

/** Parses an inline cssText blob into a property → value map. */
const parse = (cssText: string): Map<string, string> => {
  const decls = new Map<string, string>();
  for (const part of cssText.split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return decls;
};

/**
 * Stability contract: the top HUD bar must never shift, grow, wrap differently,
 * or re-flow because of what the sim pushes into it. The bar is intrinsically
 * wider than any target viewport (~2,280px single-row), so it wraps into rows —
 * stability therefore comes from every child having a constant width: numbers
 * live in reserved tabular slots, state swaps keep identical box metrics, and
 * intermittent surfaces are out of flow. Browser-verified at 1280×800.
 */
describe('top HUD bar layout stability', () => {
  it('bar container fixes wrap inputs: tabular digits, no text wrapping, constant gaps', () => {
    const bar = parse(HUD_TOP_BAR_LAYOUT_CSS);
    expect(bar.get('position')).toBe('absolute');
    expect(bar.get('top')).toBe('8px');
    expect(bar.get('left')).toBe('8px');
    // Wrapping stays enabled on purpose (content exceeds every viewport); the
    // wrap POINTS are frozen because all children below have constant widths.
    expect(bar.get('flex-wrap')).toBe('wrap');
    expect(bar.get('gap')).toBe('12px');
    expect(bar.get('align-items')).toBe('center');
    // Digits must be equal-width in every font of the fallback stack, and no
    // child text may soft-wrap and change its own height.
    expect(bar.get('font-variant-numeric')).toBe('tabular-nums');
    expect(bar.get('white-space')).toBe('nowrap');
  });

  it('stat slots reserve a fixed min-width with tabular digits and an anchor side', () => {
    const left = parse(hudStatSlotCss(9));
    expect(left.get('display')).toBe('inline-block');
    expect(left.get('min-width')).toBe('9ch');
    expect(left.get('text-align')).toBe('left');
    expect(left.get('font-variant-numeric')).toBe('tabular-nums');
    expect(left.get('white-space')).toBe('nowrap');
    const right = parse(hudStatSlotCss(6, 'right'));
    expect(right.get('min-width')).toBe('6ch');
    expect(right.get('text-align')).toBe('right');
  });

  it('slot widths cover the on-screen maxima so growth never moves neighbours', () => {
    for (const width of Object.values(STAT_SLOT_CH)) {
      expect(Number.isInteger(width)).toBe(true);
      expect(width).toBeGreaterThan(0);
    }
    // "$1,000,000" (10 glyphs; $ and commas are narrower than 1ch).
    expect(STAT_SLOT_CH.treasury).toBeGreaterThanOrEqual(10);
    // Longest rank string ("Settlement"/"Metropolis"); proportional lowercase
    // averages well under 1ch — browser-measured ≈8.9ch at 13px system-ui.
    const longestTitle = Math.max(...CITY_TITLES.map((entry) => entry.title.length));
    expect(STAT_SLOT_CH.cityTitle).toBeGreaterThanOrEqual(longestTitle);
    // "9,999,999" people, "99,999" vehicles/pedestrians, "999,999" utility units.
    expect(STAT_SLOT_CH.population).toBeGreaterThanOrEqual(9);
    expect(STAT_SLOT_CH.traffic).toBeGreaterThanOrEqual(6);
    expect(STAT_SLOT_CH.utility).toBeGreaterThanOrEqual(6);
    // "Day 9999".
    expect(STAT_SLOT_CH.day).toBeGreaterThanOrEqual(8);
  });

  it('active and inactive buttons differ only in paint, never in box metrics', () => {
    const active = parse(hudButtonCss(true));
    const inactive = parse(hudButtonCss(false));
    expect([...active.keys()].sort()).toEqual([...inactive.keys()].sort());
    // Geometry-affecting declarations must be byte-identical in both states.
    for (const prop of ['padding', 'font-size', 'line-height', 'border-radius', 'margin', 'display', 'font-weight', 'letter-spacing']) {
      expect(active.get(prop)).toBe(inactive.get(prop));
    }
    // Neither state may change glyph advance via weight.
    expect(active.has('font-weight')).toBe(false);
    // Border shorthand: width and style tokens identical; only the colour may differ.
    const borderMetrics = (value: string | undefined): string =>
      (value ?? '').split(' ').slice(0, 2).join(' ');
    expect(borderMetrics(active.get('border'))).toBe('1px solid');
    expect(borderMetrics(active.get('border'))).toBe(borderMetrics(inactive.get('border')));
    // Anything that does differ must be paint-only.
    const differing = [...active.keys()].filter((key) => active.get(key) !== inactive.get(key));
    for (const key of differing) {
      expect(['background', 'border', 'box-shadow']).toContain(key);
    }
  });

  it('the intermittent warning badge is out of flow, so toggling it cannot displace the bar', () => {
    const badge = parse(hudWarningBadgeCss());
    expect(badge.get('position')).toBe('absolute');
    expect(badge.has('top')).toBe(true);
    expect(badge.has('left')).toBe(true);
    expect(badge.get('white-space')).toBe('nowrap');
  });
});
