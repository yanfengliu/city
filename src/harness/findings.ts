import {
  IMPROVEMENT_FINDING_SCHEMA_VERSION,
  improvementFindingToMarker,
  improvementFindingsFromMarkers,
  visualPlaytestFindingsFromMarkers,
  type ImprovementDisposition,
  type ImprovementEvidenceRef,
  type ImprovementFinding,
  type ImprovementNextAction,
  type ImprovementRunManifest,
  type ImprovementVerificationStatus,
  type Marker,
  type MarkerRefs,
  type NewMarker,
  type VisualPlaytestFinding,
  type VisualPlaytestFindingCategory,
  type VisualPlaytestFindingEvidence,
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
  /** What should have happened; used by the recursive verification step. */
  expected?: string;
  /** Proposed improvement / next step. */
  suggestion?: string;
  /** Loop lifecycle status; defaults to `unverified` when omitted. */
  verificationStatus?: ImprovementVerificationStatus;
  /** Loop next action; defaults to `proposalOnly` when omitted. */
  nextAction?: ImprovementNextAction;
  /** Candidate disposition in the local improvement ledger. */
  disposition?: ImprovementDisposition;
  /** Evidence beyond the marker tick, such as a screenshot, metric, or trace row. */
  evidence?: readonly ImprovementEvidenceRef[];
  /** Optional source-run metadata when an autonomous campaign generated the finding. */
  sourceRun?: ImprovementRunManifest;
  /** Optional replay refs for entities/cells when the finding can be spatially anchored. */
  refs?: MarkerRefs;
}

/** A finding as read back from the bundle, with the tick it was anchored to. */
export interface RecordedFinding extends PlaytestFinding {
  tick: number;
  /** Canonical shared loop payload consumed by cross-game improvement tooling. */
  improvement: ImprovementFinding;
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
const VERIFICATION_STATUSES: ReadonlySet<string> = new Set<ImprovementVerificationStatus>([
  'unverified',
  'verified',
  'falsePositive',
  'fixed',
  'regressed',
]);
const NEXT_ACTIONS: ReadonlySet<string> = new Set<ImprovementNextAction>([
  'proposalOnly',
  'autoFix',
  'manualFix',
  'observeMore',
  'none',
]);
const DISPOSITIONS: ReadonlySet<string> = new Set<ImprovementDisposition>([
  'candidate',
  'accepted',
  'rejected',
  'deferred',
  'wontFix',
]);
const EVIDENCE_KINDS: ReadonlySet<string> = new Set<ImprovementEvidenceRef['kind']>([
  'tick',
  'step',
  'screenshot',
  'marker',
  'trace',
  'bundle',
  'metric',
  'text',
]);

/** Clamps loosely-typed input (harness API surface) into a valid finding. */
export function normalizeFinding(input: Partial<PlaytestFinding>): PlaytestFinding {
  const out: PlaytestFinding = {
    category: CATEGORIES.has(input.category as string) ? (input.category as FindingCategory) : 'bug',
    severity: SEVERITIES.has(input.severity as string)
      ? (input.severity as FindingSeverity)
      : 'medium',
    area: typeof input.area === 'string' && input.area ? input.area : 'general',
    observed: typeof input.observed === 'string' ? input.observed : '',
    ...(typeof input.expected === 'string' ? { expected: input.expected } : {}),
    ...(typeof input.suggestion === 'string' ? { suggestion: input.suggestion } : {}),
  };
  if (VERIFICATION_STATUSES.has(input.verificationStatus as string)) {
    out.verificationStatus = input.verificationStatus as ImprovementVerificationStatus;
  }
  if (NEXT_ACTIONS.has(input.nextAction as string)) {
    out.nextAction = input.nextAction as ImprovementNextAction;
  }
  if (DISPOSITIONS.has(input.disposition as string)) {
    out.disposition = input.disposition as ImprovementDisposition;
  }
  const evidence = normalizeEvidence(input.evidence);
  if (evidence.length > 0) out.evidence = evidence;
  const sourceRun = normalizeSourceRun(input.sourceRun);
  if (sourceRun) out.sourceRun = sourceRun;
  if (isRecord(input.refs)) out.refs = input.refs as MarkerRefs;
  return out;
}

export function playtestFindingToVisualFinding(
  input: PlaytestFinding,
  tick?: number,
): VisualPlaytestFinding {
  const finding = normalizeFinding(input);
  const evidence = visualEvidenceFromImprovementEvidence(evidenceWithTick(finding.evidence, tick));
  return {
    title: `${finding.area}: ${finding.observed || finding.category}`,
    severity: finding.severity,
    category: LEGACY_TO_VISUAL_CATEGORY[finding.category],
    area: finding.area,
    observed: finding.observed,
    ...(finding.expected ? { expected: finding.expected } : {}),
    ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    ...(evidence ? { evidence } : {}),
    ...(finding.refs ? { refs: finding.refs } : {}),
  };
}

export function visualFindingToPlaytestFinding(input: VisualPlaytestFinding): PlaytestFinding {
  return normalizeFinding({
    category: VISUAL_TO_LEGACY_CATEGORY[input.category],
    severity: VISUAL_TO_LEGACY_SEVERITY[input.severity],
    area: input.area ?? 'general',
    observed: input.observed || input.title,
    ...(typeof input.expected === 'string' ? { expected: input.expected } : {}),
    ...(typeof input.suggestion === 'string' ? { suggestion: input.suggestion } : {}),
    evidence: evidenceFromVisualFinding(input.evidence),
    ...(input.refs ? { refs: input.refs } : {}),
  });
}

export function playtestFindingToImprovementFinding(
  input: PlaytestFinding,
  tick?: number,
): ImprovementFinding {
  const finding = normalizeFinding(input);
  const observed = finding.observed || `${finding.category} finding`;
  const evidence = evidenceWithTick(finding.evidence, tick);
  return {
    schemaVersion: IMPROVEMENT_FINDING_SCHEMA_VERSION,
    id: improvementFindingId(finding, tick),
    title: `${finding.area}: ${observed}`,
    severity: finding.severity,
    category: LEGACY_TO_VISUAL_CATEGORY[finding.category],
    observed,
    ...(finding.expected ? { expected: finding.expected } : {}),
    ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    area: finding.area,
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(finding.refs ? { refs: finding.refs } : {}),
    verificationStatus: finding.verificationStatus ?? 'unverified',
    nextAction: finding.nextAction ?? 'proposalOnly',
    disposition: finding.disposition ?? 'candidate',
    ...(finding.sourceRun ? { sourceRun: finding.sourceRun } : {}),
    data: {
      cityFindingCategory: finding.category,
    },
  };
}

export function improvementFindingToPlaytestFinding(input: ImprovementFinding): PlaytestFinding {
  return normalizeFinding({
    category: VISUAL_TO_LEGACY_CATEGORY[input.category],
    severity: VISUAL_TO_LEGACY_SEVERITY[input.severity],
    area: input.area ?? 'general',
    observed: input.observed || input.title,
    ...(typeof input.expected === 'string' ? { expected: input.expected } : {}),
    ...(typeof input.suggestion === 'string' ? { suggestion: input.suggestion } : {}),
    evidence: input.evidence,
    verificationStatus: input.verificationStatus,
    nextAction: input.nextAction,
    ...(input.disposition ? { disposition: input.disposition } : {}),
    ...(input.sourceRun ? { sourceRun: input.sourceRun } : {}),
    ...(input.refs ? { refs: input.refs } : {}),
  });
}

export function recordedFindingFromPlaytestFinding(
  input: Partial<PlaytestFinding>,
  tick: number,
): RecordedFinding {
  const finding = normalizeFinding(input);
  const improvement = playtestFindingToImprovementFinding(finding, tick);
  return {
    tick,
    ...finding,
    verificationStatus: improvement.verificationStatus,
    nextAction: improvement.nextAction,
    ...(improvement.disposition ? { disposition: improvement.disposition } : {}),
    ...(improvement.evidence ? { evidence: improvement.evidence } : {}),
    improvement,
  };
}

/** A finding -> a civ-engine annotation marker for the recorder. */
export function findingToMarker(finding: PlaytestFinding, tick?: number): NewMarker {
  const normalized = normalizeFinding(finding);
  const loopFinding = playtestFindingToImprovementFinding(normalized, tick);
  const marker = improvementFindingToMarker(loopFinding);
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
    const [improvementFinding] = improvementFindingsFromMarkers([m]);
    if (improvementFinding) {
      out.push({
        tick: m.tick,
        ...improvementFindingToPlaytestFinding(improvementFinding),
        improvement: improvementFinding,
      });
      continue;
    }
    const dataFinding = legacyFindingData(m.data);
    if (dataFinding) {
      out.push(recordedFindingFromPlaytestFinding(dataFinding, m.tick));
      continue;
    }
    const [visualFinding] = visualPlaytestFindingsFromMarkers([m]);
    if (visualFinding) {
      out.push(recordedFindingFromPlaytestFinding(visualFindingToPlaytestFinding(visualFinding), m.tick));
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

function evidenceWithTick(
  evidence: readonly ImprovementEvidenceRef[] | undefined,
  tick: number | undefined,
): ImprovementEvidenceRef[] {
  const out: ImprovementEvidenceRef[] = [];
  if (tick !== undefined) out.push({ kind: 'tick', tick });
  for (const ref of normalizeEvidence(evidence)) {
    if (tick !== undefined && ref.kind === 'tick' && ref.tick === tick) continue;
    out.push(ref);
  }
  return out;
}

function evidenceFromVisualFinding(
  evidence: VisualPlaytestFindingEvidence | undefined,
): ImprovementEvidenceRef[] {
  if (!evidence) return [];
  const out: ImprovementEvidenceRef[] = [];
  if (isNonNegativeInteger(evidence.tick)) out.push({ kind: 'tick', tick: evidence.tick });
  if (isNonNegativeInteger(evidence.step)) out.push({ kind: 'step', step: evidence.step });
  if (typeof evidence.screenshotPath === 'string' && evidence.screenshotPath) {
    out.push({ kind: 'screenshot', screenshotPath: evidence.screenshotPath });
  }
  if (Array.isArray(evidence.stateLabels) && evidence.stateLabels.every((label) => typeof label === 'string')) {
    out.push({ kind: 'trace', stateLabels: [...evidence.stateLabels] });
  }
  if (isNonNegativeInteger(evidence.actionIndex)) {
    out.push({ kind: 'trace', actionIndex: evidence.actionIndex });
  }
  return out;
}

function visualEvidenceFromImprovementEvidence(
  evidence: readonly ImprovementEvidenceRef[],
): VisualPlaytestFindingEvidence | undefined {
  const out: VisualPlaytestFindingEvidence = {};
  for (const ref of evidence) {
    if (out.tick === undefined && ref.tick !== undefined) out.tick = ref.tick;
    if (out.step === undefined && ref.step !== undefined) out.step = ref.step;
    if (out.actionIndex === undefined && ref.actionIndex !== undefined) out.actionIndex = ref.actionIndex;
    if (out.screenshotPath === undefined && ref.screenshotPath !== undefined) {
      out.screenshotPath = ref.screenshotPath;
    }
    if (out.stateLabels === undefined && ref.stateLabels !== undefined) out.stateLabels = [...ref.stateLabels];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeEvidence(
  evidence: readonly ImprovementEvidenceRef[] | undefined,
): ImprovementEvidenceRef[] {
  if (!Array.isArray(evidence)) return [];
  const out: ImprovementEvidenceRef[] = [];
  for (const ref of evidence) {
    if (!isRecord(ref) || !EVIDENCE_KINDS.has(ref.kind as string)) continue;
    const kind = ref.kind as ImprovementEvidenceRef['kind'];
    const next: ImprovementEvidenceRef = { kind };
    for (const key of ['tick', 'step', 'actionIndex'] as const) {
      if (isNonNegativeInteger(ref[key])) next[key] = ref[key];
    }
    if (kind === 'tick' && next.tick === undefined) continue;
    for (const key of ['screenshotPath', 'markerId', 'bundleId', 'sessionId', 'label', 'value'] as const) {
      if (typeof ref[key] === 'string' && ref[key]) next[key] = ref[key];
    }
    if (Array.isArray(ref.stateLabels) && ref.stateLabels.every((label) => typeof label === 'string')) {
      next.stateLabels = [...ref.stateLabels];
    }
    const data = jsonRoundTrip(ref.data);
    if (data !== undefined) next.data = data as ImprovementEvidenceRef['data'];
    out.push(next);
  }
  return out;
}

function normalizeSourceRun(sourceRun: ImprovementRunManifest | undefined): ImprovementRunManifest | undefined {
  if (!isRecord(sourceRun) || sourceRun.schemaVersion !== 1 || typeof sourceRun.id !== 'string' || !sourceRun.id) {
    return undefined;
  }
  const out: ImprovementRunManifest = { schemaVersion: 1, id: sourceRun.id };
  for (const key of ['gameId', 'objective', 'startedAt', 'completedAt', 'bundleId', 'sessionId'] as const) {
    if (typeof sourceRun[key] === 'string') out[key] = sourceRun[key];
  }
  if (Array.isArray(sourceRun.tags) && sourceRun.tags.every((tag) => typeof tag === 'string')) {
    out.tags = [...sourceRun.tags];
  }
  const data = jsonRoundTrip(sourceRun.data);
  if (data !== undefined) out.data = data as ImprovementRunManifest['data'];
  return out;
}

function improvementFindingId(finding: PlaytestFinding, tick: number | undefined): string {
  return [
    'city',
    tick === undefined ? 'unticked' : String(tick),
    slug(finding.area),
    slug(finding.category),
    stableHash([
      finding.observed,
      finding.expected ?? '',
      finding.suggestion ?? '',
    ].join('|')),
  ].join('-');
}

function slug(value: string): string {
  const out = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return out || 'finding';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function jsonRoundTrip(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? undefined : JSON.parse(encoded);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
