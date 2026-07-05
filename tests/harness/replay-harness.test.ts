import { describe, expect, it } from 'vitest';
import { MemorySink, SessionRecorder, type SessionBundle } from 'civ-engine';
import { createCitySim, type CitySimConfig } from '../../src/sim/city';
import { buildDistrict, findLandBlock } from '../sim/helpers';
import { findingToMarker, findingsFromMarkers } from '../../src/harness/findings';
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
      findingToMarker(
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
});
