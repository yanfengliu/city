import type { ImprovementFinding, ImprovementRunManifest } from 'civ-engine';

export interface RecursivePassManifestInput {
  id: string;
  startedAt: string;
  completedAt: string;
  durationMs?: number;
  provider?: string;
  sessionId?: string | null;
  candidate: ImprovementFinding | null;
  verification?: { ok: boolean; checkedSegments?: number; skippedSegments?: number } | null;
  forcedOutcome?: 'run-failed';
  artifacts?: readonly { kind: string; path: string }[];
}

export function engineFindingOf(row: unknown): ImprovementFinding | null;
export function selectFixCandidate(rows: readonly unknown[] | undefined): ImprovementFinding | null;
export function passOutcome(candidate: ImprovementFinding | null): 'proposal-only' | 'no-fix-candidate';
export function buildPassManifest(input: RecursivePassManifestInput): ImprovementRunManifest;
