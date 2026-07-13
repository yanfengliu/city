import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureCanvasAtCssSize } from '../../src/rendering/screenshot';

function sourceCanvas(width: number, height: number, cssWidth: number, cssHeight: number) {
  return {
    width,
    height,
    getBoundingClientRect: () => ({ width: cssWidth, height: cssHeight }),
    toDataURL: vi.fn(() => 'source-jpeg'),
  } as unknown as HTMLCanvasElement;
}

describe('CSS-sized WebGL screenshots', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the WebGL canvas directly at DPR 1', () => {
    const source = sourceCanvas(1280, 720, 1280, 720);

    expect(captureCanvasAtCssSize(source, 0.8)).toBe('source-jpeg');
    expect(source.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
  });

  it('downsamples a high-DPI buffer to CSS-space dimensions', () => {
    const source = sourceCanvas(1920, 1080, 1280, 720);
    const drawImage = vi.fn();
    const capture = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toDataURL: vi.fn(() => 'css-jpeg'),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => capture),
    });

    expect(captureCanvasAtCssSize(source, 0.7)).toBe('css-jpeg');
    expect(capture.width).toBe(1280);
    expect(capture.height).toBe(720);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1280, 720);
    expect(capture.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
  });

  it('fails clearly instead of returning mismatched high-DPI dimensions', () => {
    const source = sourceCanvas(1920, 1080, 1280, 720);
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => null,
      })),
    });

    expect(() => captureCanvasAtCssSize(source, 0.6)).toThrow(
      'CSS-sized screenshot capture requires a 2D canvas context',
    );
    expect(source.toDataURL).not.toHaveBeenCalled();
  });
});
