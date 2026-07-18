import { describe, expect, it } from 'vitest';
import {
  OVERLAY_STATUS_RGBA,
  fieldStatus,
  utilityStatus,
  type OverlayStatus,
} from '../../src/rendering/overlay-semantics';

/** Perceived lightness, for asserting the "shades of one family" contract. */
function luminance([r, g, b]: readonly number[]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isGreenFamily(rgba: readonly number[]): boolean {
  const [r, g, b] = rgba;
  return g > r && g > b;
}

describe('overlay status palette', () => {
  it('paints every provided-status shade from one green family', () => {
    for (const status of ['source', 'provided', 'reach'] as const) {
      expect(isGreenFamily(OVERLAY_STATUS_RGBA[status])).toBe(true);
    }
  });

  it('orders the provided shades source > provided > reach by opacity', () => {
    const alpha = (s: OverlayStatus) => OVERLAY_STATUS_RGBA[s][3];
    expect(alpha('source')).toBeGreaterThan(alpha('provided'));
    expect(alpha('provided')).toBeGreaterThan(alpha('reach'));
  });

  it('keeps neutral achromatic so unaffected ground reads as grey', () => {
    const [r, g, b] = OVERLAY_STATUS_RGBA.neutral;
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('makes warn yellow and severe red, with severe the most alarming', () => {
    const warn = OVERLAY_STATUS_RGBA.warn;
    const severe = OVERLAY_STATUS_RGBA.severe;
    // Yellow: red and green both high, blue low.
    expect(warn[0]).toBeGreaterThan(150);
    expect(warn[1]).toBeGreaterThan(150);
    expect(warn[2]).toBeLessThan(warn[1]);
    // Red: red dominant.
    expect(severe[0]).toBeGreaterThan(150);
    expect(severe[0]).toBeGreaterThan(severe[1] + 80);
    expect(luminance(severe)).toBeLessThan(luminance(warn));
  });
});

describe('utilityStatus', () => {
  const served = { powered: true, watered: true, abandoned: false, utilityDistress: 0 };

  it('reports provided while the utility reaches the building', () => {
    expect(utilityStatus('power', served)).toBe('provided');
    expect(utilityStatus('water', served)).toBe('provided');
  });

  it('warns as soon as the utility is missing but the building is coping', () => {
    expect(utilityStatus('power', { ...served, powered: false })).toBe('warn');
    expect(utilityStatus('water', { ...served, watered: false })).toBe('warn');
  });

  it('escalates to severe as the building nears abandonment', () => {
    expect(
      utilityStatus('power', { ...served, powered: false, utilityDistress: 0.9 }),
    ).toBe('severe');
  });

  it('treats an already-abandoned building as severe', () => {
    expect(utilityStatus('power', { ...served, abandoned: true })).toBe('severe');
  });

  it('ignores the other utility entirely', () => {
    // No water must not colour the power overlay.
    expect(utilityStatus('power', { ...served, watered: false })).toBe('provided');
  });
});

describe('fieldStatus', () => {
  it('leaves a clean cell neutral so only real problems carry colour', () => {
    expect(fieldStatus('pollution', 0)).toBe('neutral');
    expect(fieldStatus('noise', 0)).toBe('neutral');
  });

  it('rises through warn to severe as a nuisance field grows', () => {
    expect(fieldStatus('pollution', 0.5)).toBe('warn');
    expect(fieldStatus('pollution', 1)).toBe('severe');
  });

  it('reads land value the other way: high value is the good end', () => {
    expect(fieldStatus('landValue', 1)).toBe('provided');
    expect(fieldStatus('landValue', 0)).toBe('severe');
  });

  it('marks coverage fields provided or neutral, never alarming', () => {
    for (const field of ['fireCoverage', 'policeCoverage', 'healthCoverage', 'educationCoverage'] as const) {
      expect(fieldStatus(field, 1)).toBe('provided');
      expect(fieldStatus(field, 0)).toBe('neutral');
      // Absence lowers land value but never abandons, so it never alarms.
      for (const value of [0, 0.25, 0.5, 0.75, 1]) {
        expect(['neutral', 'provided']).toContain(fieldStatus(field, value));
      }
    }
  });
});
