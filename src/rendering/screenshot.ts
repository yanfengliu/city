/**
 * Captures WebGL at CSS-pixel dimensions so screenshot coordinates stay in the
 * same space as pointer input even when the renderer uses a high-DPI buffer.
 */
export function captureCanvasAtCssSize(
  source: HTMLCanvasElement,
  quality: number,
): string {
  const bounds = source.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  if (source.width === width && source.height === height) {
    return source.toDataURL('image/jpeg', quality);
  }

  const capture = document.createElement('canvas');
  capture.width = width;
  capture.height = height;
  const context = capture.getContext('2d');
  if (!context) {
    throw new Error('CSS-sized screenshot capture requires a 2D canvas context');
  }
  context.drawImage(source, 0, 0, width, height);
  return capture.toDataURL('image/jpeg', quality);
}
