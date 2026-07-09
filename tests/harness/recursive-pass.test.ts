// Bare 'fs' specifier on purpose: vite.config.ts aliases 'node:fs' to a
// browser shim for the game bundle, and that alias also applies in vitest.
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { assertImprovementRunManifest, type ImprovementFinding } from 'civ-engine';
import {
  buildPassManifest,
  engineFindingOf,
  selectFixCandidate,
} from '../../scripts/recursive-pass.mjs';

function engineFinding(id: string, severity: string, nextAction: string): ImprovementFinding {
  return {
    schemaVersion: 1,
    id,
    title: id,
    severity,
    category: 'bug',
    observed: 'observed',
    verificationStatus: 'unverified',
    nextAction,
  } as ImprovementFinding;
}

describe('selectFixCandidate', () => {
  it('unwraps city RecordedFinding rows and ranks by severity among fix-classified findings', () => {
    const rows = [
      { tick: 5, improvement: engineFinding('low-fix', 'low', 'autoFix') },
      { tick: 6, improvement: engineFinding('high-proposal', 'high', 'proposalOnly') },
      { tick: 7, improvement: engineFinding('high-fix', 'high', 'manualFix') },
    ];
    expect(selectFixCandidate(rows)?.id).toBe('high-fix');
    expect(engineFindingOf(rows[0]).id).toBe('low-fix');
  });

  it('returns null when nothing fixable is open', () => {
    expect(selectFixCandidate([
      { improvement: { ...engineFinding('closed', 'high', 'autoFix'), disposition: 'rejected' } },
      { improvement: engineFinding('observe', 'high', 'observeMore') },
    ])).toBeNull();
    expect(selectFixCandidate([])).toBeNull();
  });
});

describe('buildPassManifest', () => {
  it('builds a validated engine manifest with the outcome vocabulary', () => {
    const manifest = buildPassManifest({
      id: 'city-recursive-x',
      startedAt: '2026-07-08T12:00:00.000Z',
      completedAt: '2026-07-08T12:04:00.000Z',
      durationMs: 240_000,
      provider: 'scripted',
      sessionId: 'session-9',
      candidate: engineFinding('hud-broken', 'high', 'autoFix'),
      verification: { ok: true, checkedSegments: 1, skippedSegments: 0 },
      artifacts: [{ kind: 'run-dir', path: 'output/playtests-llm/x' }],
    });
    expect(() => assertImprovementRunManifest(manifest)).not.toThrow();
    expect(manifest.stopReason).toBe('proposal-only');
    expect(manifest.sessionId).toBe('session-9');
    expect(manifest.data).toMatchObject({ outcome: 'proposal-only', candidateFindingId: 'hud-broken' });
  });

  it('supports forced run-failed outcomes', () => {
    const manifest = buildPassManifest({
      id: 'city-recursive-failed',
      startedAt: '2026-07-08T12:00:00.000Z',
      completedAt: '2026-07-08T12:00:30.000Z',
      candidate: null,
      forcedOutcome: 'run-failed',
      artifacts: [],
    });
    expect(() => assertImprovementRunManifest(manifest)).not.toThrow();
    expect(manifest.stopReason).toBe('run-failed');
  });
});

describe('playtest-recursive script wiring', () => {
  const source = readFileSync(new URL('../../scripts/playtest-recursive.mjs', import.meta.url), 'utf8');

  it('runs the autonomous loop and persists the pass artifacts', () => {
    expect(source).toContain("'run', 'playtest:llm'");
    expect(source).toContain('selectFixCandidate');
    expect(source).toContain('pass-manifest.json');
    expect(source).toContain('passes.jsonl');
  });
});
