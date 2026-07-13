// Bare 'fs' specifier on purpose: vite.config.ts aliases 'node:fs' to a
// browser shim for the game bundle, and that alias also applies in vitest.
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

// The autonomous loop must stay on the player surface and the shared engine
// contracts. These pins mirror the visual-host honesty tests: the script may
// read the harness's visual host and session exports, but never the command()
// backdoor or private state.
describe('llm-visual-loop script wiring', () => {
  const source = readFileSync(new URL('../../scripts/llm-visual-loop.mjs', import.meta.url), 'utf8');

  it('drives the shared civ-engine runner with hardened options', () => {
    expect(source).toContain("from 'civ-engine'");
    expect(source).toContain('runVisualPlaytestLoop');
    expect(source).toContain("promptMode: 'oracleAssisted'");
    expect(source).toContain("agentObservation: 'redacted'");
    expect(source).toContain("onActionFailure: 'continue'");
    expect(source).toContain('maxWallClockMs');
    expect(source).toContain('buildVisualPlaytestPromptParts');
  });

  it('proxies the in-page visual host and session exports', () => {
    expect(source).toContain('window.__harness.visualHost().observe()');
    expect(source).toContain('window.__harness.visualHost().performAction(a)');
    expect(source).toContain('window.__harness.getBundle()');
    expect(source).toContain('window.__harness.selfCheck()');
  });

  it('explicitly opts its dev page into replay recording', () => {
    expect(source).toContain("url.searchParams.set('record', '1')");
  });

  it('never reports a zero-segment self-check as verified', () => {
    expect(source).toContain('selfCheck.ok === true && checkedSegments > 0');
  });

  it('never uses the command backdoor or private harness state', () => {
    expect(source).not.toContain('__harness.command');
    expect(source).not.toContain('__harness.state()');
    expect(source).not.toContain('__harness.advance');
  });

  it('persists a validated run manifest and appends the ledger', () => {
    expect(source).toContain('createImprovementRunManifest');
    expect(source).toContain('ledger.jsonl');
    expect(source).toContain("gameId: 'city'");
  });

  it('normalizes the self-check skipped segments to a count', () => {
    expect(source).toContain('selfCheck.skippedSegments.length');
  });
});
