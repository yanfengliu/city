import { describe, expect, it } from 'vitest';
import {
  IMPROVEMENT_FINDING_SCHEMA_VERSION,
  MemorySink,
  SessionRecorder,
  improvementFindingsFromMarkers,
  visualPlaytestFindingsFromMarkers,
  type SessionBundle,
} from 'civ-engine';
import { createCitySim, type CitySimConfig } from '../../src/sim/city';
import { buildDistrict, findLandBlock } from '../sim/helpers';
import {
  cityFindingToImprovementFinding,
  cityFindingToMarker,
  cityFindingToVisualFinding,
  findingsFromMarkers,
} from '../../src/harness/findings';
import { dogfoodRecursiveImprovementLoop } from '../../src/harness/dogfood';
import { inspectBundle, selfCheckBundle } from '../../src/harness/inspect';
import type { CityCommands, CityEvents } from '../../src/sim/types';

/**
 * End-to-end proof of the playtest harness (docs/harness.md): record a session,
 * annotate a finding as a marker, then replay + self-check + inspect — the exact
 * pipeline the browser `__harness` drives, verified browser-free.
 */
describe('playtest harness pipeline', () => {
  it('records → annotates → replays → self-checks → inspects at the finding tick', () => {
    const config: CitySimConfig = {
      seed: 7,
      fieldsEnabled: true,
      utilitiesEnabled: true,
      highwayEnabled: true,
    };
    const sim = createCitySim(config);
    const sink = new MemorySink();
    const recorder = new SessionRecorder({ world: sim.world, sink });
    recorder.connect();

    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 300; i++) sim.world.step();

    // What the browser __harness.annotate does: a finding marker at the tick.
    const findingTick = sim.world.tick;
    recorder.addMarker(
      cityFindingToMarker(
        {
          category: 'balance',
          severity: 'medium',
          area: 'growth',
          observed: 'R district grew but stayed at level 1',
          suggestion: 'place services to raise land value',
        },
        findingTick,
      ),
    );

    for (let i = 0; i < 300; i++) sim.world.step();
    recorder.disconnect();
    const bundle = recorder.toBundle() as unknown as SessionBundle<CityEvents, CityCommands>;

    const report = inspectBundle(bundle, config);

    // (1) Determinism: the recorded session replays identically (the gate).
    expect(report.selfCheck.ok, JSON.stringify(report.selfCheck, null, 2)).toBe(true);

    // (2) The finding round-tripped as a marker anchored to its tick.
    expect(report.findings).toHaveLength(1);
    const { finding, state } = report.findings[0];
    expect(finding.tick).toBe(findingTick);
    expect(finding.category).toBe('balance');
    expect(finding.area).toBe('growth');

    // (3) Ground-truth state at the finding tick is materializable and coherent.
    expect(state.tick).toBe(findingTick);
    expect(state.buildings.total).toBeGreaterThan(0);
    expect(state.population).toBeGreaterThan(0);

    // (4) Trajectory sampled across the session.
    expect(report.timeline.length).toBeGreaterThan(1);
    expect(report.timeline[report.timeline.length - 1].tick).toBeGreaterThan(
      report.timeline[0].tick,
    );

    // Marker reader is symmetric with the writer.
    expect(findingsFromMarkers(bundle.markers)).toHaveLength(1);
  });

  it('selfCheck on a still-connected recorder is not vacuous (needs a terminal snapshot)', () => {
    // The worker runs selfCheck WITHOUT disconnecting (the live session keeps
    // recording). A connected recorder has only the initial + periodic (every
    // 1000-tick) snapshots, so selfCheck — which walks snapshot PAIRS — would
    // check ZERO segments on a short session. The worker takes a terminal
    // snapshot first; this pins that the check then actually verifies ticks.
    const config: CitySimConfig = {
      seed: 7,
      fieldsEnabled: true,
      utilitiesEnabled: true,
      highwayEnabled: true,
    };
    const sim = createCitySim(config);
    const recorder = new SessionRecorder({ world: sim.world, sink: new MemorySink() });
    recorder.connect();
    buildDistrict(sim, 'R', findLandBlock(sim, 18, 18));
    for (let i = 0; i < 300; i++) sim.world.step(); // short: under the 1000-tick snapshot interval

    // Without a terminal snapshot the tail is unchecked (vacuously ok).
    const vacuous = selfCheckBundle(
      recorder.toBundle() as unknown as SessionBundle<CityEvents, CityCommands>,
      config,
    );
    expect(vacuous.ok).toBe(true);
    expect(vacuous.checkedSegments).toBe(0);

    // The worker's fix: take a terminal snapshot, THEN check → real coverage.
    recorder.takeSnapshot();
    const real = selfCheckBundle(
      recorder.toBundle() as unknown as SessionBundle<CityEvents, CityCommands>,
      config,
    );
    expect(real.ok, JSON.stringify(real)).toBe(true);
    expect(real.checkedSegments).toBeGreaterThan(0);
  });

  it('stores standardized improvement loop marker data without emitting legacy finding payloads', () => {
    const marker = cityFindingToMarker(
      {
        category: 'ux',
        severity: 'high',
        area: 'onboarding',
        observed: 'The founding tip is hidden behind the HUD',
        expected: 'The first build tip stays visible while the HUD is open',
        suggestion: 'Move the tip below the top bar',
      },
      42,
    );

    expect(marker.tick).toBe(42);
    expect(marker.data).toMatchObject({
      visualPlaytest: {
        schemaVersion: 1,
        type: 'finding',
        finding: {
          category: 'usability',
          severity: 'high',
          area: 'onboarding',
          observed: 'The founding tip is hidden behind the HUD',
          expected: 'The first build tip stays visible while the HUD is open',
          evidence: { tick: 42 },
        },
      },
      improvementLoop: {
        schemaVersion: IMPROVEMENT_FINDING_SCHEMA_VERSION,
        type: 'finding',
        finding: {
          schemaVersion: IMPROVEMENT_FINDING_SCHEMA_VERSION,
          id: expect.stringMatching(/^city-42-onboarding-ux-/),
          title: 'onboarding: The founding tip is hidden behind the HUD',
          category: 'usability',
          severity: 'high',
          area: 'onboarding',
          observed: 'The founding tip is hidden behind the HUD',
          expected: 'The first build tip stays visible while the HUD is open',
          suggestion: 'Move the tip below the top bar',
          evidence: [{ kind: 'tick', tick: 42 }],
          verificationStatus: 'unverified',
          nextAction: 'proposalOnly',
          disposition: 'candidate',
          data: { cityFindingCategory: 'ux' },
        },
      },
    });
    expect(marker.data).not.toHaveProperty('playtestFinding');

    const recorded = findingsFromMarkers([
      {
        id: 'm1',
        tick: 42,
        kind: 'annotation',
        provenance: 'game',
        data: marker.data,
      },
    ]);
    expect(recorded).toEqual([
      {
        tick: 42,
        category: 'ux',
        severity: 'high',
        area: 'onboarding',
        observed: 'The founding tip is hidden behind the HUD',
        expected: 'The first build tip stays visible while the HUD is open',
        suggestion: 'Move the tip below the top bar',
        verificationStatus: 'unverified',
        nextAction: 'proposalOnly',
        disposition: 'candidate',
        evidence: [{ kind: 'tick', tick: 42 }],
        improvement: expect.objectContaining({
          verificationStatus: 'unverified',
          nextAction: 'proposalOnly',
          disposition: 'candidate',
          data: { cityFindingCategory: 'ux' },
        }),
      },
    ]);
    expect(
      improvementFindingsFromMarkers([
        {
          id: 'm1',
          tick: 42,
          kind: 'annotation',
          provenance: 'game',
          data: marker.data,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        schemaVersion: IMPROVEMENT_FINDING_SCHEMA_VERSION,
        id: expect.stringMatching(/^city-42-onboarding-ux-/),
        verificationStatus: 'unverified',
        nextAction: 'proposalOnly',
      }),
    ]);
    expect(
      visualPlaytestFindingsFromMarkers([
        {
          id: 'm1',
          tick: 42,
          kind: 'annotation',
          provenance: 'game',
          data: marker.data,
        },
      ]),
    ).toHaveLength(1);
  });

  it('synthesizes a full loop finding for legacy marker bundles', () => {
    const recorded = findingsFromMarkers([
      {
        id: 'legacy',
        tick: 11,
        kind: 'annotation',
        provenance: 'game',
        data: {
          playtestFinding: {
            category: 'bug',
            severity: 'medium',
            area: 'traffic',
            observed: 'Vehicles stop forever at the first junction',
          },
        },
      },
    ]);

    expect(recorded).toEqual([
      {
        tick: 11,
        category: 'bug',
        severity: 'medium',
        area: 'traffic',
        observed: 'Vehicles stop forever at the first junction',
        verificationStatus: 'unverified',
        nextAction: 'proposalOnly',
        disposition: 'candidate',
        evidence: [{ kind: 'tick', tick: 11 }],
        improvement: expect.objectContaining({
          schemaVersion: IMPROVEMENT_FINDING_SCHEMA_VERSION,
          id: expect.stringMatching(/^city-11-traffic-bug-/),
          category: 'bug',
          verificationStatus: 'unverified',
          nextAction: 'proposalOnly',
          disposition: 'candidate',
          evidence: [{ kind: 'tick', tick: 11 }],
          data: { cityFindingCategory: 'bug' },
        }),
      },
    ]);
  });

  it('lets city callers classify findings into the shared recursive-loop lifecycle', () => {
    const finding = cityFindingToImprovementFinding(
      {
        category: 'perf',
        severity: 'medium',
        area: 'large-city-render',
        observed: 'Frame time spikes when 500 buildings level up together',
        expected: 'The renderer keeps level-up effects bounded under mass growth',
        suggestion: 'Pool and cap simultaneous level-up labels',
        verificationStatus: 'verified',
        nextAction: 'manualFix',
        disposition: 'accepted',
        evidence: [{ kind: 'metric', label: 'fps', value: '18' }],
      },
      128,
    );

    expect(finding).toMatchObject({
      schemaVersion: IMPROVEMENT_FINDING_SCHEMA_VERSION,
      id: expect.stringMatching(/^city-128-large-city-render-perf-/),
      title: 'large-city-render: Frame time spikes when 500 buildings level up together',
      category: 'performance',
      severity: 'medium',
      area: 'large-city-render',
      observed: 'Frame time spikes when 500 buildings level up together',
      expected: 'The renderer keeps level-up effects bounded under mass growth',
      suggestion: 'Pool and cap simultaneous level-up labels',
      verificationStatus: 'verified',
      nextAction: 'manualFix',
      disposition: 'accepted',
      evidence: [
        { kind: 'tick', tick: 128 },
        { kind: 'metric', label: 'fps', value: '18' },
      ],
      data: { cityFindingCategory: 'perf' },
    });
    expect(
      cityFindingToVisualFinding(
        {
          category: 'perf',
          severity: 'medium',
          area: 'large-city-render',
          observed: 'Frame time spikes when 500 buildings level up together',
          evidence: [
            { kind: 'metric', label: 'fps', value: '18' },
            { kind: 'screenshot', screenshotPath: 'artifacts/large-city.png' },
          ],
        },
        128,
      ).evidence,
    ).toMatchObject({
      tick: 128,
      screenshotPath: 'artifacts/large-city.png',
    });
  });

  it('dogfoods the recursive loop with verified findings and before/after comparison', async () => {
    const report = await dogfoodRecursiveImprovementLoop();

    expect(report.loop.ok).toBe(true);
    expect(report.loop.stopReason).toBe('agentStop');
    expect(report.finding.verificationStatus).toBe('verified');
    expect(report.finding.nextAction).toBe('none');
    expect(report.finding.disposition).toBe('accepted');
    expect(report.finding.improvement.verificationStatus).toBe('verified');
    expect(report.finding.improvement.nextAction).toBe('none');
    expect(report.finding.improvement.disposition).toBe('accepted');
    expect(report.finding.improvement.evidence?.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['tick', 'step', 'metric', 'text']),
    );
    expect(report.selfCheck.ok).toBe(true);
    expect(report.selfCheck.checkedSegments).toBeGreaterThan(0);
    expect(report.inspection.hasSummary).toBe(true);
    expect(report.bundle.findings).toBe(1);
    expect(report.bundle.hasImprovementLoop).toBe(true);
    expect(report.bundle.hasLegacyPlaytestFinding).toBe(false);
    expect(report.before.tick).toBeLessThan(report.after.tick);
    expect(report.comparison.populationDidNotRegress).toBe(true);
    expect(report.comparison.roadCountStable).toBe(true);
  });
});
