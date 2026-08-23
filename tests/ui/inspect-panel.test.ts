import { describe, expect, it } from 'vitest';
import {
  INSPECT_PANEL_LAYOUT_CSS,
  inspectPanelMaxHeight,
  inspectPanelShouldResetScroll,
  inspectSectionKey,
  inspectSectionOpen,
  type InspectSection,
} from '../../src/ui/inspect-panel';
import { meterStatus } from '../../src/ui/inspect-meter';

function declarations(cssText: string): Map<string, string> {
  return new Map(
    cssText
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const colon = part.indexOf(':');
        return [part.slice(0, colon), part.slice(colon + 1)] as const;
      }),
  );
}

describe('InspectPanel layout', () => {
  it('fits a readable desktop column while keeping long citizen histories scrollable', () => {
    const css = declarations(INSPECT_PANEL_LAYOUT_CSS);
    expect(css.get('width')).toBe('380px');
    expect(css.get('max-width')).toBe('calc(100vw - 16px)');
    expect(css.get('max-height')).toBe('calc(100vh - 84px)');
    expect(css.get('overflow-y')).toBe('auto');
    expect(css.get('overscroll-behavior')).toBe('contain');
    expect(css.get('box-sizing')).toBe('border-box');
  });

  it('keeps a long inspector below the wrapped HUD in the 1280x720 browser layout', () => {
    expect(inspectPanelMaxHeight(0, 720, 165)).toBe(539);
  });

  it('retains scroll for one resident refresh but resets for another subject', () => {
    expect(inspectPanelShouldResetScroll('citizen:1:0:2', 'citizen:1:0:2')).toBe(false);
    expect(inspectPanelShouldResetScroll('citizen:1:0:0', 'citizen:1:0:2')).toBe(true);
    expect(inspectPanelShouldResetScroll('citizen:1:0:2', 'citizen:2:0:2')).toBe(true);
    expect(inspectPanelShouldResetScroll(null, 'citizen:1:0:2')).toBe(true);
  });
});

/**
 * Expansion is modelled outside the DOM on purpose: the panel refreshes twice a
 * second while a subject is open, and the rule that matters — a refresh must
 * never reopen a section the player closed — is a state question, not a
 * rendering one. The rendering itself is verified in the browser.
 */
function section(overrides: Partial<InspectSection> = {}): InspectSection {
  return { id: 'growth', heading: 'Growth', lines: ['a'], ...overrides };
}

describe('inspector sections', () => {
  it('keys collapse state on the stable id, not the live heading', () => {
    const before = section({ id: 'members', heading: 'Household members (3)' });
    const after = section({ id: 'members', heading: 'Household members (2)' });

    expect(inspectSectionKey(before)).toBe(inspectSectionKey(after));
    // A section that forgot its id degrades to the heading, and moving counts
    // would then lose the player's choice — which is why `id` exists.
    expect(inspectSectionKey({ heading: 'Growth', lines: [] })).toBe('Growth');
  });

  it('opens by default and honours a section that asks to start closed', () => {
    const empty = new Map<string, boolean>();

    expect(inspectSectionOpen(section(), empty)).toBe(true);
    expect(inspectSectionOpen(section({ startCollapsed: true }), empty)).toBe(false);
  });

  it('lets the player-s own toggle win over the default, in both directions', () => {
    const closedByPlayer = new Map([['growth', false]]);
    const openedByPlayer = new Map([['growth', true]]);

    expect(inspectSectionOpen(section(), closedByPlayer)).toBe(false);
    expect(inspectSectionOpen(section({ startCollapsed: true }), openedByPlayer)).toBe(true);
  });

  it('keeps a pinned section open and ignores any stale toggle for it', () => {
    const stale = new Map([['growth', false]]);

    expect(inspectSectionOpen(section({ collapsible: false }), stale)).toBe(true);
  });
});

describe('inspector meters', () => {
  it('reads a full bar as good, and as bad when the meter is a nuisance', () => {
    expect(meterStatus(0.9)).toBe('provided');
    expect(meterStatus(0.45)).toBe('warn');
    expect(meterStatus(0.1)).toBe('severe');
    // Abandonment risk and utility load fill up as things get WORSE.
    expect(meterStatus(0.9, true)).toBe('severe');
    expect(meterStatus(0.1, true)).toBe('provided');
  });
});
