import { SessionReplayer, snapshotAtTick, type SessionBundle } from 'civ-engine';
import { createCitySim, rebuildDerived, type CitySimConfig } from '../sim/city';
import { simSummary, summaryLine, type SimSummary } from '../sim/summary';
import { findingsFromMarkers, type RecordedFinding } from './findings';
import type { CityCommands, CityEvents, CityWorld } from '../sim/types';

export interface SelfCheckSummary {
  ok: boolean;
  checkedSegments: number;
  stateDivergences: number;
  eventDivergences: number;
  executionDivergences: number;
  skippedSegments: number;
  /** First serialized-state path that diverged, if any (the debugging anchor). */
  firstDivergingPath?: string;
}

export interface InspectionReport {
  selfCheck: SelfCheckSummary;
  /** Each recorded finding with the ground-truth city state at its tick. */
  findings: Array<{ finding: RecordedFinding; state: SimSummary }>;
  /** Evenly-sampled city summaries across the session, for the trajectory. */
  timeline: SimSummary[];
}

/** Rebuilds a city world from a snapshot — the SessionReplayer worldFactory
 * contract. `config.seed` must match the recording (it regenerates terrain). */
export function cityWorldFactory(config: CitySimConfig) {
  return (snapshot: Parameters<CityWorld['applySnapshot']>[0]): CityWorld => {
    const sim = createCitySim(config);
    sim.world.applySnapshot(snapshot);
    rebuildDerived(sim);
    return sim.world;
  };
}

/** Runs civ-engine's 3-stream determinism check over a bundle, flattened. */
export function selfCheckBundle(
  bundle: SessionBundle<CityEvents, CityCommands>,
  config: CitySimConfig,
): SelfCheckSummary {
  const replayer = SessionReplayer.fromBundle(bundle, { worldFactory: cityWorldFactory(config) });
  const raw = replayer.selfCheck();
  return {
    ok: raw.ok,
    checkedSegments: raw.checkedSegments,
    stateDivergences: raw.stateDivergences.length,
    eventDivergences: raw.eventDivergences.length,
    executionDivergences: raw.executionDivergences.length,
    skippedSegments: raw.skippedSegments.length,
    firstDivergingPath: raw.stateDivergences[0]?.firstDifferingPath,
  };
}

/** Materializes the city at a bundle tick (pure snapshot fold → fresh sim). */
function cityAtTick(
  bundle: SessionBundle<CityEvents, CityCommands>,
  tick: number,
  config: CitySimConfig,
) {
  const snapshot = snapshotAtTick(bundle, tick);
  const sim = createCitySim(config);
  sim.world.applySnapshot(snapshot as Parameters<typeof sim.world.applySnapshot>[0]);
  rebuildDerived(sim);
  return sim;
}

/**
 * Replays a recorded session and reports: (1) civ-engine's determinism
 * self-check, (2) the ground-truth state at every annotated finding, and (3) a
 * sampled trajectory. `config` MUST be the recording config (its seed
 * regenerates the un-serialized terrain — see docs/harness.md).
 */
export function inspectBundle(
  bundle: SessionBundle<CityEvents, CityCommands>,
  config: CitySimConfig,
): InspectionReport {
  const selfCheck = selfCheckBundle(bundle, config);

  const findings = findingsFromMarkers(bundle.markers).map((finding) => ({
    finding,
    state: simSummary(cityAtTick(bundle, finding.tick, config).world),
  }));

  const start = bundle.metadata.startTick ?? 0;
  const end = bundle.metadata.endTick ?? start;
  const timeline: SimSummary[] = [];
  const SAMPLES = 8;
  const span = Math.max(0, end - start);
  const seen = new Set<number>();
  for (let i = 0; i <= SAMPLES; i++) {
    const tick = span === 0 ? start : start + Math.round((span * i) / SAMPLES);
    if (seen.has(tick)) continue;
    seen.add(tick);
    timeline.push(simSummary(cityAtTick(bundle, tick, config).world));
  }
  return { selfCheck, findings, timeline };
}

/** Human-readable inspection report for logs / the replay-inspect script. */
export function formatReport(report: InspectionReport): string {
  const lines: string[] = [];
  const sc = report.selfCheck;
  lines.push(
    `selfCheck ${sc.ok ? 'OK' : 'FAILED'} — segments ${sc.checkedSegments}, ` +
      `state/event/exec divergences ${sc.stateDivergences}/${sc.eventDivergences}/${sc.executionDivergences}` +
      (sc.firstDivergingPath ? `, first path: ${sc.firstDivergingPath}` : ''),
  );
  lines.push(`timeline (${report.timeline.length}):`);
  for (const s of report.timeline) lines.push('  ' + summaryLine(s));
  lines.push(`findings (${report.findings.length}):`);
  for (const { finding, state } of report.findings) {
    lines.push(
      `  @t${finding.tick} [${finding.category}/${finding.severity}] ${finding.area}: ${finding.observed}` +
        (finding.suggestion ? ` → ${finding.suggestion}` : ''),
    );
    lines.push('    state: ' + summaryLine(state));
  }
  return lines.join('\n');
}
