import {
  UTILITY_ICON_BADGE_STROKE_COLOR,
  UTILITY_ICON_POWER_BADGE_COLOR,
  UTILITY_ICON_WATER_BADGE_COLOR,
} from './constants';

export type UtilityIconBadgeKind = 'power' | 'water';

export interface UtilityIconBadgePart {
  kind: UtilityIconBadgeKind;
  color: number;
  shape: 'diamond' | 'circle';
}

export interface UtilityIconBadgeLayout {
  parts: UtilityIconBadgePart[];
  canvasWidth: number;
  canvasHeight: number;
  spriteWidth: number;
}

export interface UtilityIconBadgeCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
}

const powerKey = '\u26a1';
const waterKey = '\u{1f4a7}';
const BADGE_CANVAS_SIZE = 128;
const BADGE_RADIUS = 44;
const BADGE_STROKE_WIDTH = 6;

const hexColor = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export function utilityIconBadgeParts(key: string): UtilityIconBadgePart[] {
  const parts: UtilityIconBadgePart[] = [];
  if (key.includes(powerKey)) {
    parts.push({ kind: 'power', color: UTILITY_ICON_POWER_BADGE_COLOR, shape: 'diamond' });
  }
  if (key.includes(waterKey)) {
    parts.push({ kind: 'water', color: UTILITY_ICON_WATER_BADGE_COLOR, shape: 'circle' });
  }
  return parts;
}

export function utilityIconBadgeLayout(key: string): UtilityIconBadgeLayout {
  const parts = utilityIconBadgeParts(key);
  const spriteWidth = Math.max(1, parts.length);
  return {
    parts,
    canvasWidth: spriteWidth * BADGE_CANVAS_SIZE,
    canvasHeight: BADGE_CANVAS_SIZE,
    spriteWidth,
  };
}

function drawPowerBolt(ctx: UtilityIconBadgeCanvasContext, cx: number, cy: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - 34);
  ctx.lineTo(cx + 20, cy - 34);
  ctx.lineTo(cx + 3, cy - 4);
  ctx.lineTo(cx + 24, cy - 4);
  ctx.lineTo(cx - 13, cy + 36);
  ctx.lineTo(cx - 1, cy + 8);
  ctx.lineTo(cx - 25, cy + 8);
  ctx.closePath();
  ctx.fillStyle = '#fff4c7';
  ctx.strokeStyle = hexColor(UTILITY_ICON_BADGE_STROKE_COLOR);
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();
}

function drawWaterDrop(ctx: UtilityIconBadgeCanvasContext, cx: number, cy: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - 36);
  ctx.bezierCurveTo(cx + 28, cy - 4, cx + 30, cy + 13, cx + 18, cy + 26);
  ctx.bezierCurveTo(cx + 8, cy + 37, cx - 8, cy + 37, cx - 18, cy + 26);
  ctx.bezierCurveTo(cx - 30, cy + 13, cx - 28, cy - 4, cx, cy - 36);
  ctx.closePath();
  ctx.fillStyle = '#eaf8ff';
  ctx.strokeStyle = hexColor(UTILITY_ICON_BADGE_STROKE_COLOR);
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.stroke();
}

function drawBadge(ctx: UtilityIconBadgeCanvasContext, part: UtilityIconBadgePart, cx: number, cy: number): void {
  ctx.beginPath();
  if (part.shape === 'diamond') {
    ctx.moveTo(cx, cy - BADGE_RADIUS);
    ctx.lineTo(cx + BADGE_RADIUS, cy);
    ctx.lineTo(cx, cy + BADGE_RADIUS);
    ctx.lineTo(cx - BADGE_RADIUS, cy);
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, BADGE_RADIUS, 0, Math.PI * 2);
  }
  ctx.fillStyle = hexColor(part.color);
  ctx.strokeStyle = hexColor(UTILITY_ICON_BADGE_STROKE_COLOR);
  ctx.lineWidth = BADGE_STROKE_WIDTH;
  ctx.fill();
  ctx.stroke();
  if (part.kind === 'power') {
    drawPowerBolt(ctx, cx, cy);
  } else {
    drawWaterDrop(ctx, cx, cy);
  }
}

export function drawUtilityIconBadges(ctx: UtilityIconBadgeCanvasContext, key: string): void {
  const layout = utilityIconBadgeLayout(key);
  ctx.clearRect(0, 0, layout.canvasWidth, layout.canvasHeight);
  for (const [index, part] of layout.parts.entries()) {
    drawBadge(ctx, part, index * BADGE_CANVAS_SIZE + BADGE_CANVAS_SIZE / 2, BADGE_CANVAS_SIZE / 2);
  }
}
