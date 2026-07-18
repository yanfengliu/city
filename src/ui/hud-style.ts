function css(parts: string[]): string {
  return `${parts.join(';')};`;
}

export const HUD_TEXT = '#18353f';
export const HUD_MUTED_TEXT = '#425e68';
export const HUD_ACCENT_TEXT = '#00526c';
export const HUD_POSITIVE_TEXT = '#145c2c';
export const HUD_NEGATIVE_TEXT = '#8f3526';
export const HUD_DIVIDER_COLOR = '#7fb6c1';
export const HUD_ROW_BORDER = 'rgba(31,132,155,.2)';

export const HUD_PANEL_CHROME_CSS = css([
  `color:${HUD_TEXT}`,
  'background:linear-gradient(180deg,rgba(235,247,248,.95),rgba(207,230,233,.92))',
  'border:1px solid rgba(31,132,155,.42)',
  'border-radius:6px',
  'box-shadow:inset 0 1px 0 rgba(255,255,255,.72),0 8px 22px rgba(35,72,80,.22)',
]);

/**
 * Layout half of the top HUD bar (skin comes from HUD_PANEL_CHROME_CSS).
 * Stability contract (tests/ui/hud-layout.test.ts): the bar must never shift,
 * grow, or re-flow at runtime. Its intrinsic single-row width (~2,280px)
 * exceeds every target viewport, so flex wrapping stays enabled — immovability
 * comes from every child having a constant width (see hudStatSlotCss), which
 * freezes the wrap points for any given window size. tabular-nums keeps digit
 * advances equal in every font of the page's fallback stack, and nowrap stops
 * any child's text from soft-wrapping and changing row heights.
 */
export const HUD_TOP_BAR_LAYOUT_CSS = css([
  'position:absolute',
  'top:8px',
  'left:8px',
  'padding:8px 12px',
  'font-size:13px',
  'display:flex',
  'gap:12px',
  'align-items:center',
  'flex-wrap:wrap',
  'max-width:calc(100vw - 32px)',
  'white-space:nowrap',
  'font-variant-numeric:tabular-nums',
  'user-select:none',
  'z-index:10',
]);

/**
 * A fixed-width inline slot for one live value (number or rank text): reserves
 * its on-screen maximum up front via min-width so value changes can never move
 * siblings or re-flow the bar's wrap points. Anchor the stable side: 'left'
 * lets the value grow rightwards into its own reserve, 'right' pins the value's
 * end (used for the numerator of the utility "demand/supply" pairs so the
 * slash never moves).
 */
export function hudStatSlotCss(minWidthCh: number, align: 'left' | 'right' = 'left'): string {
  return css([
    'display:inline-block',
    `min-width:${minWidthCh}ch`,
    `text-align:${align}`,
    'font-variant-numeric:tabular-nums',
    'white-space:nowrap',
  ]);
}

export const HUD_COMPACT_PANEL_CHROME_CSS = css([
  `color:${HUD_TEXT}`,
  'background:linear-gradient(180deg,rgba(238,248,247,.94),rgba(213,232,234,.92))',
  'border:1px solid rgba(31,132,155,.3)',
  'border-radius:5px',
  'box-shadow:inset 0 1px 0 rgba(255,255,255,.62),0 4px 14px rgba(35,72,80,.18)',
]);

export const HUD_HEADER_STRIP_CSS = css([
  'background:linear-gradient(180deg,rgba(90,188,204,.25),rgba(171,220,225,.18))',
  `border-bottom:1px solid ${HUD_ROW_BORDER}`,
]);

export function hudButtonCss(active = false): string {
  const background = active
    ? 'linear-gradient(180deg,#63d3e4,#2eb2ca)'
    : 'linear-gradient(180deg,#e1f1f1,#b9dce0)';
  const border = active ? '1px solid rgba(21,126,151,.78)' : '1px solid rgba(66,133,147,.5)';
  return css([
    `background:${background}`,
    `color:${HUD_TEXT}`,
    `border:${border}`,
    'border-radius:4px',
    'padding:3px 8px',
    'cursor:pointer',
    'font-size:13px',
    'line-height:1.25',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,.68),0 1px 2px rgba(35,72,80,.22)',
    'text-shadow:0 1px 0 rgba(255,255,255,.42)',
  ]);
}

export function hudIconButtonCss(): string {
  return css([
    'background:none',
    'border:none',
    `color:${HUD_ACCENT_TEXT}`,
    'cursor:pointer',
    'font-size:16px',
    'line-height:1',
    'padding:0 2px',
    'text-shadow:0 1px 0 rgba(255,255,255,.5)',
  ]);
}

export function hudKeyBadgeCss(): string {
  return css([
    'margin-left:5px',
    'padding:0 3px',
    'font-size:9px',
    'font-weight:bold',
    'line-height:13px',
    'display:inline-block',
    'min-width:9px',
    'text-align:center',
    `color:${HUD_ACCENT_TEXT}`,
    'background:rgba(255,255,255,.46)',
    'border:1px solid rgba(31,132,155,.38)',
    'border-radius:3px',
  ]);
}

/**
 * Intermittent "⚠ BROKE" / disconnected-trips badge. Absolutely positioned
 * below the bar's left corner (its containing block is the bar) so appearing,
 * growing, or vanishing can never displace the bar's in-flow children —
 * part of the layout-stability contract in tests/ui/hud-layout.test.ts.
 */
export function hudWarningBadgeCss(): string {
  return css([
    'position:absolute',
    'top:calc(100% + 6px)',
    'left:0',
    'white-space:nowrap',
    'color:#071116',
    'background:linear-gradient(180deg,#ffd95b,#ff9e35)',
    'font-weight:bold',
    'border-radius:4px',
    'padding:1px 6px',
    'display:none',
    'box-shadow:inset 0 1px 0 rgba(255,250,200,.42),0 1px 2px rgba(0,0,0,.35)',
  ]);
}

export function hudToastCss(): string {
  return css([
    'color:#7c2f22',
    'background:linear-gradient(180deg,rgba(255,240,232,.97),rgba(255,217,199,.95))',
    'border:1px solid rgba(190,87,55,.5)',
    'padding:6px 14px',
    'border-radius:5px',
    'font-size:13px',
    'box-shadow:0 2px 8px rgba(70,48,40,.24)',
  ]);
}

export const HUD_MILESTONE_BANNER_CSS = css([
  'color:#244534',
  'background:linear-gradient(180deg,rgba(255,250,214,.97),rgba(224,244,207,.96))',
  'border:1px solid rgba(99,156,80,.72)',
  'box-shadow:0 5px 20px rgba(50,80,60,.22)',
]);
