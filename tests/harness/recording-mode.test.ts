// Bare 'fs' on purpose: vite.config.ts aliases 'node:fs' to the browser shim.
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { playtestRecordingRequested } from '../../src/harness/recording-mode';

const gameSource = readFileSync('src/app/game.ts', 'utf8');

describe('playtest recording mode', () => {
  it('is disabled for ordinary localhost sessions', () => {
    expect(playtestRecordingRequested('')).toBe(false);
    expect(playtestRecordingRequested('?foo=bar')).toBe(false);
    expect(playtestRecordingRequested('?record=true')).toBe(false);
  });

  it('requires the explicit record=1 query flag', () => {
    expect(playtestRecordingRequested('?record=1')).toBe(true);
    expect(playtestRecordingRequested('?foo=bar&record=1')).toBe(true);
  });

  it('rejects recorder-only debug requests immediately when mode is disabled', () => {
    expect(gameSource).toContain('if (!this.recordPlaytest)');
    expect(gameSource).toContain("Promise.reject(new Error('playtest recording unavailable; reload with ?record=1'))");
  });
});
