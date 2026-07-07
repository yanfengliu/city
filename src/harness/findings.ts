import {
  visualPlaytestFindingToMarker,
  visualPlaytestFindingsFromMarkers,
  type Marker,
  type NewMarker,
  type VisualPlaytestFinding,
  type VisualPlaytestFindingCategory,
  type VisualPlaytestFindingSeverity,
} from 'civ-engine';

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
const LEGACY_TO_VISUAL_CATEGORY: Record<FindingCategory, VisualPlaytestFindingCategory> = {
  bug: 'bug',
  balance: 'rules',
  ux: 'usability',
  'missing-feature': 'opportunity',
  visual: 'visual',
  perf: 'performance',
};
const VISUAL_TO_LEGACY_CATEGORY: Record<VisualPlaytestFindingCategory, FindingCategory> = {
  visual: 'visual',
  usability: 'ux',
  rules: 'balance',
  performance: 'perf',
  accessibility: 'ux',
  regression: 'bug',
  bug: 'bug',
  opportunity: 'missing-feature',
};
const VISUAL_TO_LEGACY_SEVERITY: Record<VisualPlaytestFindingSeverity, FindingSeverity> = {
  info: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'high',
};

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

export function playtestFindingToVisualFinding(
  input: PlaytestFinding,
  tick?: number,
): VisualPlaytestFinding {
  const finding = normalizeFinding(input);
  return {
    title: `${finding.area}: ${finding.observed || finding.category}`,
    severity: finding.severity,
    category: LEGACY_TO_VISUAL_CATEGORY[finding.category],
    area: finding.area,
    observed: finding.observed,
    ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    ...(tick !== undefined ? { evidence: { tick } } : {}),
  };
}

export function visualFindingToPlaytestFinding(input: VisualPlaytestFinding): PlaytestFinding {
  return normalizeFinding({
    category: VISUAL_TO_LEGACY_CATEGORY[input.category],
    severity: VISUAL_TO_LEGACY_SEVERITY[input.severity],
    area: input.area ?? 'general',
    observed: input.observed || input.title,
    ...(typeof input.suggestion === 'string' ? { suggestion: input.suggestion } : {}),
  });
}

/** A finding -> a civ-engine annotation marker for the recorder. */
export function findingToMarker(finding: PlaytestFinding, tick?: number): NewMarker {
  const normalized = normalizeFinding(finding);
  const marker = visualPlaytestFindingToMarker(
    playtestFindingToVisualFinding(normalized, tick),
  );
  const markerData = isRecord(marker.data) ? marker.data : {};
  const out: NewMarker = {
    kind: 'annotation',
    text: `[${normalized.category}/${normalized.severity}] ${normalized.area}: ${normalized.observed}`,
    ...(marker.refs ? { refs: marker.refs } : {}),
    data: {
      ...markerData,
      playtestFinding: normalized,
    } as unknown as NewMarker['data'],
  };
  if (tick !== undefined) out.tick = tick;
  return out;
}

/** Reads playtest findings back out of a bundle's markers, sorted by tick. */
export function findingsFromMarkers(markers: readonly Marker[]): RecordedFinding[] {
  const out: RecordedFinding[] = [];
  for (const m of markers) {
    if (m.kind !== 'annotation') continue;
    const dataFinding = legacyFindingData(m.data);
    if (dataFinding) {
      out.push({ tick: m.tick, ...normalizeFinding(dataFinding) });
      continue;
    }
    const [visualFinding] = visualPlaytestFindingsFromMarkers([m]);
    if (visualFinding) {
      out.push({ tick: m.tick, ...visualFindingToPlaytestFinding(visualFinding) });
    }
  }
  return out.sort((a, b) => a.tick - b.tick);
}

function legacyFindingData(data: Marker['data']): Partial<PlaytestFinding> | null {
  if (!isRecord(data)) return null;
  const nested = data.playtestFinding;
  if (isRecord(nested) && typeof nested.observed === 'string') {
    return nested as Partial<PlaytestFinding>;
  }
  if (typeof data.observed === 'string') return data as Partial<PlaytestFinding>;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
