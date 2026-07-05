import type { Marker, NewMarker } from 'civ-engine';

/**
 * Structured playtest findings, adapted from aoe2's `ConformanceFinding`. A
 * finding is recorded as a civ-engine `annotation` marker anchored to the tick
 * it was observed at, so it round-trips through the replay bundle and can be
 * jumped to for debugging (see docs/harness.md).
 */
export type FindingCategory =
  | 'bug'
  | 'balance'
  | 'ux'
  | 'missing-feature'
  | 'visual'
  | 'perf';

export type FindingSeverity = 'low' | 'medium' | 'high';

export interface PlaytestFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  /** Free-form subsystem, e.g. 'onboarding', 'traffic', 'economy'. */
  area: string;
  /** What the run showed. */
  observed: string;
  /** Proposed improvement / next step. */
  suggestion?: string;
}

/** A finding as read back from the bundle, with the tick it was anchored to. */
export interface RecordedFinding extends PlaytestFinding {
  tick: number;
}

const CATEGORIES: ReadonlySet<string> = new Set<FindingCategory>([
  'bug',
  'balance',
  'ux',
  'missing-feature',
  'visual',
  'perf',
]);
const SEVERITIES: ReadonlySet<string> = new Set<FindingSeverity>(['low', 'medium', 'high']);

/** Clamps loosely-typed input (harness API surface) into a valid finding. */
export function normalizeFinding(input: Partial<PlaytestFinding>): PlaytestFinding {
  return {
    category: CATEGORIES.has(input.category as string) ? (input.category as FindingCategory) : 'bug',
    severity: SEVERITIES.has(input.severity as string)
      ? (input.severity as FindingSeverity)
      : 'medium',
    area: typeof input.area === 'string' && input.area ? input.area : 'general',
    observed: typeof input.observed === 'string' ? input.observed : '',
    ...(typeof input.suggestion === 'string' ? { suggestion: input.suggestion } : {}),
  };
}

/** A finding → a civ-engine annotation marker for the recorder. */
export function findingToMarker(finding: PlaytestFinding, tick?: number): NewMarker {
  const marker: NewMarker = {
    kind: 'annotation',
    text: `[${finding.category}/${finding.severity}] ${finding.area}: ${finding.observed}`,
    data: finding as unknown as NewMarker['data'],
  };
  if (tick !== undefined) marker.tick = tick;
  return marker;
}

/** Reads playtest findings back out of a bundle's markers, sorted by tick. */
export function findingsFromMarkers(markers: readonly Marker[]): RecordedFinding[] {
  const out: RecordedFinding[] = [];
  for (const m of markers) {
    if (m.kind !== 'annotation' || !m.data || typeof m.data !== 'object') continue;
    const d = m.data as Partial<PlaytestFinding>;
    if (typeof d.observed !== 'string') continue;
    out.push({ tick: m.tick, ...normalizeFinding(d) });
  }
  return out.sort((a, b) => a.tick - b.tick);
}
