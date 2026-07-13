import { describe, expect, it } from 'vitest';

import {
  HUD_ACCENT_TEXT,
  HUD_MILESTONE_BANNER_CSS,
  HUD_MUTED_TEXT,
  HUD_NEGATIVE_TEXT,
  HUD_PANEL_CHROME_CSS,
  HUD_POSITIVE_TEXT,
  HUD_ROW_BORDER,
  HUD_TEXT,
  hudButtonCss,
  hudKeyBadgeCss,
  hudWarningBadgeCss,
} from '../../src/ui/hud-style';

const OLD_WEB_BUTTON_COLORS = /#(?:2b3d4f|4a7db5|4a6076)/i;

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrast = (foreground: string, background: string): number => {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const composite = (foreground: string, background: string, alpha: number): string => {
  const channels = (hex: string): number[] =>
    [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const foregroundChannels = channels(foreground);
  const backgroundChannels = channels(background);
  return `#${foregroundChannels
    .map((channel, index) => Math.round(channel * alpha + backgroundChannels[index] * (1 - alpha)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
};

describe('HUD skin', () => {
  it('uses light frosted city-planner chrome instead of near-black controls', () => {
    const inactive = hudButtonCss(false);
    const active = hudButtonCss(true);

    expect(HUD_PANEL_CHROME_CSS).toContain('linear-gradient');
    expect(HUD_PANEL_CHROME_CSS).toContain('box-shadow');
    expect(inactive).toContain('border-radius:4px');
    expect(inactive).toContain('text-shadow');
    expect(HUD_TEXT).toBe('#18353f');
    expect(HUD_PANEL_CHROME_CSS).toContain('rgba(235,247,248,.95)');
    expect(inactive).toContain('#e1f1f1');
    expect(active).toContain('#63d3e4');
    expect(inactive).not.toContain('#12191e');
    expect(active).not.toBe(inactive);

    for (const css of [HUD_PANEL_CHROME_CSS, inactive, active]) {
      expect(css).not.toMatch(OLD_WEB_BUTTON_COLORS);
    }
  });

  it('keeps status accents readable on the friendly light surface', () => {
    expect(HUD_ROW_BORDER).toContain('31,132,155');
    expect(hudKeyBadgeCss()).toContain('min-width:9px');
    expect(hudKeyBadgeCss()).toContain('#00526c');
    expect(hudWarningBadgeCss()).toContain('#071116');
    expect(HUD_MILESTONE_BANNER_CSS).toContain('#244534');
    expect(HUD_MILESTONE_BANNER_CSS).toContain('rgba(255,250,214,.97)');
    const panelOverRoad = composite('#cfe6e9', '#333a40', 0.92);
    const keyBadgeOnActiveButton = composite('#ffffff', '#2eb2ca', 0.46);
    for (const color of [HUD_MUTED_TEXT, HUD_ACCENT_TEXT, HUD_POSITIVE_TEXT, HUD_NEGATIVE_TEXT]) {
      expect(contrast(color, panelOverRoad)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(HUD_ACCENT_TEXT, keyBadgeOnActiveButton)).toBeGreaterThanOrEqual(4.5);
  });
});
