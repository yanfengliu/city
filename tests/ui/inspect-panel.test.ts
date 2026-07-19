import { describe, expect, it } from 'vitest';
import {
  INSPECT_PANEL_LAYOUT_CSS,
  inspectPanelMaxHeight,
  inspectPanelShouldResetScroll,
} from '../../src/ui/inspect-panel';

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
