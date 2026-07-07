import { describe, expect, it } from 'vitest';

import {
  HUD_PANEL_CHROME_CSS,
  HUD_ROW_BORDER,
  hudButtonCss,
  hudKeyBadgeCss,
  hudWarningBadgeCss,
} from '../../src/ui/hud-style';

const OLD_WEB_BUTTON_COLORS = /#(?:2b3d4f|4a7db5|4a6076)/i;

describe('HUD skin', () => {
  it('uses compact city-planner chrome instead of generic blue web buttons', () => {
    const inactive = hudButtonCss(false);
    const active = hudButtonCss(true);

    expect(HUD_PANEL_CHROME_CSS).toContain('linear-gradient');
    expect(HUD_PANEL_CHROME_CSS).toContain('box-shadow');
    expect(inactive).toContain('border-radius:4px');
    expect(inactive).toContain('text-shadow');
    expect(inactive).toContain('#eef8ff');
    expect(active).toContain('#18bde8');
    expect(active).not.toBe(inactive);

    for (const css of [HUD_PANEL_CHROME_CSS, inactive, active]) {
      expect(css).not.toMatch(OLD_WEB_BUTTON_COLORS);
    }
  });

  it('keeps status accents readable on the dark civic glass surface', () => {
    expect(HUD_ROW_BORDER).toContain('110,215,255');
    expect(hudKeyBadgeCss()).toContain('min-width:9px');
    expect(hudKeyBadgeCss()).toContain('#6ed7ff');
    expect(hudWarningBadgeCss()).toContain('#071116');
  });
});
