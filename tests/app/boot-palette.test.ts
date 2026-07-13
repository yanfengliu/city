import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('boot palette', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  it('uses the friendly sky fallback without requesting a missing favicon', () => {
    expect(html).toContain('background: #d5edf8');
    expect(html).not.toContain('background: #1a2530');
    expect(html).toContain('<link rel="icon" href="data:," />');
  });
});
