import { describe, expect, it, vi } from 'vitest';
import {
  applyRenderPixelRatio,
  MAX_RENDER_PIXEL_RATIO,
  renderPixelRatio,
} from '../../src/rendering/render-pixel-ratio';

describe('render pixel ratio', () => {
  it('keeps normal-density displays native and caps expensive high-DPI buffers', () => {
    expect(renderPixelRatio(1)).toBe(1);
    expect(renderPixelRatio(1.25)).toBe(1.25);
    expect(renderPixelRatio(2)).toBe(MAX_RENDER_PIXEL_RATIO);
    expect(renderPixelRatio(3)).toBe(MAX_RENDER_PIXEL_RATIO);
  });

  it('preserves valid sub-1 browser ratios and rejects invalid browser values', () => {
    expect(renderPixelRatio(0.8)).toBe(0.8);
    expect(renderPixelRatio(Number.NaN)).toBe(1);
    expect(renderPixelRatio(Number.POSITIVE_INFINITY)).toBe(1);
    expect(renderPixelRatio(0)).toBe(1);
    expect(renderPixelRatio(-1)).toBe(1);
  });

  it('rounds browser zoom noise to stable hundredth steps', () => {
    expect(renderPixelRatio(1.254)).toBe(1.25);
    expect(renderPixelRatio(1.499)).toBe(1.5);
  });

  it('does not trigger Three.js backing-buffer work when the ratio is unchanged', () => {
    const setPixelRatio = vi.fn();
    const renderer = { getPixelRatio: () => 1.5, setPixelRatio };

    expect(applyRenderPixelRatio(renderer, 2)).toBe(1.5);
    expect(setPixelRatio).not.toHaveBeenCalled();

    renderer.getPixelRatio = () => 1;
    expect(applyRenderPixelRatio(renderer, 2)).toBe(1.5);
    expect(setPixelRatio).toHaveBeenCalledExactlyOnceWith(1.5);
  });
});
