export const MAX_RENDER_PIXEL_RATIO = 1.5;

export interface PixelRatioRenderer {
  getPixelRatio(): number;
  setPixelRatio(value: number): void;
}

function roundPixelRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Caps high-DPI backing buffers without changing CSS-space layout or input.
 *
 * A static cap is intentional: rAF cadence cannot distinguish GPU pressure
 * from display refresh rate, OS scheduling, or another busy browser. Dynamic
 * quality changes based on cadence alone would therefore blur the game for
 * causes that lowering resolution cannot fix.
 */
export function renderPixelRatio(devicePixelRatio: number): number {
  const finiteRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return roundPixelRatio(Math.min(finiteRatio, MAX_RENDER_PIXEL_RATIO));
}

/** Applies a changed ratio only, avoiding Three.js's implicit backing-buffer resize. */
export function applyRenderPixelRatio(
  renderer: PixelRatioRenderer,
  devicePixelRatio: number,
): number {
  const nextRatio = renderPixelRatio(devicePixelRatio);
  if (renderer.getPixelRatio() !== nextRatio) renderer.setPixelRatio(nextRatio);
  return nextRatio;
}
