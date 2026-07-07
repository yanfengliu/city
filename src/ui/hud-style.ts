function css(parts: string[]): string {
  return `${parts.join(';')};`;
}

export const HUD_TEXT = '#eef8ff';
export const HUD_MUTED_TEXT = '#b7c9cf';
export const HUD_ACCENT_TEXT = '#6ed7ff';
export const HUD_POSITIVE_TEXT = '#83d86d';
export const HUD_NEGATIVE_TEXT = '#ff8f5f';
export const HUD_DIVIDER_COLOR = '#557987';
export const HUD_ROW_BORDER = 'rgba(110,215,255,.14)';

export const HUD_PANEL_CHROME_CSS = css([
  `color:${HUD_TEXT}`,
  'background:linear-gradient(180deg,rgba(25,35,38,.93),rgba(9,14,18,.9))',
  'border:1px solid rgba(110,215,255,.34)',
  'border-radius:6px',
  'box-shadow:inset 0 1px 0 rgba(225,249,255,.14),0 8px 22px rgba(0,0,0,.34)',
]);

export const HUD_COMPACT_PANEL_CHROME_CSS = css([
  `color:${HUD_TEXT}`,
  'background:linear-gradient(180deg,rgba(23,33,36,.84),rgba(9,14,18,.82))',
  'border:1px solid rgba(110,215,255,.24)',
  'border-radius:5px',
  'box-shadow:inset 0 1px 0 rgba(225,249,255,.1),0 4px 14px rgba(0,0,0,.3)',
]);

export const HUD_HEADER_STRIP_CSS = css([
  'background:linear-gradient(180deg,rgba(40,120,150,.28),rgba(18,40,48,.18))',
  `border-bottom:1px solid ${HUD_ROW_BORDER}`,
]);

export function hudButtonCss(active = false): string {
  const background = active
    ? 'linear-gradient(180deg,#18bde8,#087db2)'
    : 'linear-gradient(180deg,#253239,#12191e)';
  const border = active ? '1px solid rgba(174,239,255,.86)' : '1px solid rgba(98,148,164,.64)';
  return css([
    `background:${background}`,
    `color:${HUD_TEXT}`,
    `border:${border}`,
    'border-radius:4px',
    'padding:3px 8px',
    'cursor:pointer',
    'font-size:13px',
    'line-height:1.25',
    'box-shadow:inset 0 1px 0 rgba(225,249,255,.16),0 1px 2px rgba(0,0,0,.4)',
    'text-shadow:0 1px 0 rgba(0,0,0,.65)',
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
    'text-shadow:0 1px 0 rgba(0,0,0,.6)',
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
    'background:rgba(5,24,34,.58)',
    'border:1px solid rgba(110,215,255,.42)',
    'border-radius:3px',
  ]);
}

export function hudWarningBadgeCss(): string {
  return css([
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
    'color:#fff8ec',
    'background:linear-gradient(180deg,rgba(121,46,33,.96),rgba(77,24,22,.94))',
    'border:1px solid rgba(255,143,95,.46)',
    'padding:6px 14px',
    'border-radius:5px',
    'font-size:13px',
    'box-shadow:0 2px 8px rgba(0,0,0,.45)',
  ]);
}
