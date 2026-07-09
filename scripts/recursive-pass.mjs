import { createImprovementRunManifest } from 'civ-engine';

// Pure decisions for the proposal-only recursive pass (scripts/playtest-recursive.mjs).
// city has no auto-apply arm: the pass surfaces the top fix-classified finding
// and the driving agent is the fix arm. Outcome vocabulary matches aoe2's pass.

const SEVERITY_RANK = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const FIX_ACTIONS = new Set(['autoFix', 'manualFix']);
const CLOSED_DISPOSITIONS = new Set(['rejected', 'wontFix']);

// city rows are RecordedFindings whose canonical payload sits on `.improvement`
// (the shared engine ImprovementFinding); tolerate bare engine findings too.
export function engineFindingOf(row) {
  if (row && typeof row === 'object' && row.improvement && typeof row.improvement === 'object') {
    return row.improvement;
  }
  return row ?? null;
}

export function selectFixCandidate(rows) {
  const open = (rows ?? [])
    .map(engineFindingOf)
    .filter(
      (finding) =>
        finding &&
        FIX_ACTIONS.has(finding.nextAction) &&
        !CLOSED_DISPOSITIONS.has(finding.disposition ?? 'candidate'),
    );
  open.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  return open[0] ?? null;
}

export function passOutcome(candidate) {
  return candidate ? 'proposal-only' : 'no-fix-candidate';
}

export function buildPassManifest(input) {
  const outcome = input.forcedOutcome ?? passOutcome(input.candidate);
  return createImprovementRunManifest({
    id: input.id,
    gameId: 'city',
    objective: 'Recursive self-improvement pass over the autonomous loop (proposal-only).',
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId, bundleId: input.sessionId } : {}),
    stopReason: outcome,
    provider: input.provider ?? 'scripted',
    artifacts: (input.artifacts ?? []).map((artifact) => ({ ...artifact })),
    tags: ['city', 'recursive-pass'],
    data: {
      outcome,
      ...(input.candidate ? { candidateFindingId: input.candidate.id } : {}),
      // The candidate's declared bug class (engine signature contract) so
      // fleet aggregation keys on the class, not the run-specific id.
      ...(candidateClassOf(input.candidate) ? { candidateClass: candidateClassOf(input.candidate) } : {}),
      ...(input.verification !== undefined && input.verification !== null
        ? { verification: input.verification }
        : {}),
    },
  });
}

function candidateClassOf(candidate) {
  const value = candidate?.data?.class;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
