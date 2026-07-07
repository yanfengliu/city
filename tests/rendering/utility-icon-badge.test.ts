import { describe, expect, it } from 'vitest';
import {
  UTILITY_ICON_POWER_BADGE_COLOR,
  UTILITY_ICON_WATER_BADGE_COLOR,
} from '../../src/rendering/constants';
import {
  drawUtilityIconBadges,
  utilityIconBadgeLayout,
  utilityIconBadgeParts,
  type UtilityIconBadgeCanvasContext,
} from '../../src/rendering/utility-icon-badge';

const powerKey = '\u26a1';
const waterKey = '\u{1f4a7}';

describe('utilityIconBadgeParts', () => {
  it('maps utility icon keys to compact vector badge parts instead of raw emoji glyphs', () => {
    expect(utilityIconBadgeParts(powerKey)).toEqual([
      { kind: 'power', color: UTILITY_ICON_POWER_BADGE_COLOR },
    ]);
    expect(utilityIconBadgeParts(waterKey)).toEqual([
      { kind: 'water', color: UTILITY_ICON_WATER_BADGE_COLOR },
    ]);
    expect(utilityIconBadgeParts(`${powerKey}${waterKey}`)).toEqual([
      { kind: 'power', color: UTILITY_ICON_POWER_BADGE_COLOR },
      { kind: 'water', color: UTILITY_ICON_WATER_BADGE_COLOR },
    ]);
    expect(utilityIconBadgeParts('')).toEqual([]);
  });

  it('pins the texture aspect and sprite width used by UtilityIconsFx', () => {
    expect(utilityIconBadgeLayout(powerKey)).toMatchObject({
      canvasWidth: 128,
      canvasHeight: 128,
      spriteWidth: 1,
    });
    expect(utilityIconBadgeLayout(`${powerKey}${waterKey}`)).toMatchObject({
      canvasWidth: 256,
      canvasHeight: 128,
      spriteWidth: 2,
    });
  });

  it('draws vector badge primitives without relying on font glyph rendering', () => {
    const calls: string[] = [];
    const ctx: UtilityIconBadgeCanvasContext = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'miter',
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      closePath: () => calls.push('closePath'),
      bezierCurveTo: () => calls.push('bezierCurveTo'),
      arc: () => calls.push('arc'),
      clearRect: () => calls.push('clearRect'),
      fill: () => calls.push('fill'),
      stroke: () => calls.push('stroke'),
    };

    drawUtilityIconBadges(ctx, `${powerKey}${waterKey}`);

    expect(calls.filter((call) => call === 'arc')).toHaveLength(2);
    expect(calls).toContain('lineTo');
    expect(calls).toContain('bezierCurveTo');
  });
});
