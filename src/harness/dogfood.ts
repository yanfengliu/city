import {
  MemorySink,
  SessionRecorder,
  runVisualPlaytestLoop,
  type SessionBundle,
  type VisualPlaytestAction,
  type VisualPlaytestActionResult,
  type VisualPlaytestHost,
  type VisualPlaytestLoopResult,
  type VisualPlaytestObservation,
} from 'civ-engine';
import { TICK_MS } from '../sim/constants/map';
import { createCitySim, type CitySim, type CitySimConfig } from '../sim/city';
import { cellIndex } from '../sim/grid';
import { simSummary, summaryLine, type SimSummary } from '../sim/summary';
import type { CityCommands, CityEvents, ZoneType } from '../sim/types';
import {
  cityFindingToMarker,
  findingsFromMarkers,
  visualFindingToCityFinding,
  type RecordedFinding,
} from './findings';
import { inspectBundle, type SelfCheckSummary } from './inspect';

const DOGFOOD_RUN_ID = 'city-recursive-loop-dogfood-2026-07-08';
const DOGFOOD_CONFIG = {
  seed: 17,
  fieldsEnabled: true,
  utilitiesEnabled: true,
  highwayEnabled: true,
} satisfies CitySimConfig;

export interface DogfoodImprovementReport {
  loop: VisualPlaytestLoopResult;
  before: SimSummary;
  after: SimSummary;
  finding: RecordedFinding;
  selfCheck: SelfCheckSummary;
  inspection: {
    tick: number;
    hasSummary: boolean;
    population?: number;
    roads?: number;
  };
  bundle: {
    findings: number;
    markers: number;
    hasImprovementLoop: boolean;
    hasLegacyPlaytestFinding: boolean;
  };
  comparison: {
    populationDidNotRegress: boolean;
    roadCountStable: boolean;
    beforePopulation: number;
    afterPopulation: number;
    beforeRoadCells: number;
    afterRoadCells: number;
  };
}

/**
 * Runs the recursive improvement loop against a deterministic city session.
 * This is CI-friendly dogfood for the browser harness contract: run, record,
 * find, verify, classify, rerun, compare, and leave a replayable marker.
 */
export async function dogfoodRecursiveImprovementLoop(): Promise<DogfoodImprovementReport> {
  const sim = createCitySim(DOGFOOD_CONFIG);
  const recorder = new SessionRecorder({ world: sim.world, sink: new MemorySink() }) as SessionRecorder<
    CityEvents,
    CityCommands
  >;
  recorder.connect();

  buildDogfoodDistrict(sim);
  step(sim, 320);
  const before = simSummary(sim.world);

  let activeTool = 'select';
  const recordedFindings = (): RecordedFinding[] => findingsFromMarkers(recordedBundle(recorder).markers);
  const host: VisualPlaytestHost = {
    observe: ({ step: loopStep }) => observation(sim, activeTool, loopStep, recordedFindings()),
    performAction: (action) => {
      const result = performDogfoodAction(sim, action, (tool) => {
        activeTool = tool;
      });
      return {
        ...result,
        observation: observation(sim, activeTool, sim.world.tick, recordedFindings()),
      };
    },
    annotate: (finding, ctx) => {
      const cityFinding = visualFindingToCityFinding(finding);
      recorder.addMarker(
        cityFindingToMarker(
          {
            ...cityFinding,
            verificationStatus: 'verified',
            // Engine 2.0.0: a verified finding must carry HOW it was
            // confirmed plus an addressed replayable ref - the dogfood
            // session is replay-verified below, and the tick anchors it.
            verificationMethod: 'replay',
            nextAction: 'none',
            disposition: 'accepted',
            evidence: [
              { kind: 'tick', tick: sim.world.tick },
              { kind: 'step', step: ctx.step },
              { kind: 'metric', label: 'controls', value: String(ctx.observation.controls?.length ?? 0) },
              { kind: 'text', label: 'summary', value: summaryLine(simSummary(sim.world)) },
            ],
            sourceRun: {
              schemaVersion: 1,
              id: DOGFOOD_RUN_ID,
              gameId: 'city',
              objective: 'Dogfood the recursive improvement loop against a city replay session',
              tags: ['dogfood', 'recursive-loop', 'visual-playtest'],
            },
          },
          sim.world.tick,
        ),
      );
    },
  };

  const loop = await runVisualPlaytestLoop({
    host,
    maxSteps: 1,
    traceObservation: 'full',
    agent: {
      decide: ({ observation: seen, step: loopStep }) => ({
        rationale: 'Verify the harness can observe, classify a finding, act, and compare state.',
        findings: [
          {
            title: 'Recursive loop dogfood evidence',
            severity: 'low',
            category: 'usability',
            area: 'recursive-loop-dogfood',
            observed: 'The dogfood loop observed city state and exercised a host-exposed Road control.',
            expected: 'The loop records a standardized improvement finding and replay-verifies the session.',
            suggestion: 'Use this report as harness evidence; no gameplay fix is proposed.',
            evidence: {
              step: loopStep,
              stateLabels: seen.state?.map((channel) => channel.label),
            },
          },
        ],
        actions: [
          { kind: 'click', target: 'hud:Road' },
          { kind: 'wait', durationMs: 250 },
          { kind: 'stop', reason: 'dogfood complete' },
        ],
      }),
    },
  });

  const after = simSummary(sim.world);
  recorder.takeSnapshot();
  recorder.disconnect();

  const bundle = recordedBundle(recorder);
  const inspectionReport = inspectBundle(bundle, DOGFOOD_CONFIG);
  const findingState = inspectionReport.findings[0]?.state;
  const finding = findingsFromMarkers(bundle.markers)[0];
  if (!finding) throw new Error('dogfood loop did not record a finding');

  return {
    loop,
    before,
    after,
    finding,
    selfCheck: inspectionReport.selfCheck,
    inspection: {
      tick: finding.tick,
      hasSummary: findingState !== undefined,
      ...(findingState ? { population: findingState.population, roads: findingState.roadCells } : {}),
    },
    bundle: {
      findings: inspectionReport.findings.length,
      markers: bundle.markers.length,
      hasImprovementLoop: bundle.markers.some((marker) => hasMarkerPayload(marker.data, 'improvementLoop')),
      hasLegacyPlaytestFinding: bundle.markers.some((marker) =>
        hasMarkerPayload(marker.data, 'playtestFinding'),
      ),
    },
    comparison: {
      populationDidNotRegress: after.population >= before.population,
      roadCountStable: after.roadCells === before.roadCells,
      beforePopulation: before.population,
      afterPopulation: after.population,
      beforeRoadCells: before.roadCells,
      afterRoadCells: after.roadCells,
    },
  };
}

function observation(
  sim: CitySim,
  activeTool: string,
  stepIndex: number,
  findings: readonly RecordedFinding[],
): VisualPlaytestObservation {
  const summary = simSummary(sim.world);
  return {
    screenshot: {
      dataUrl: 'data:image/png;base64,',
      mime: 'image/png',
      alt: 'Headless dogfood observation',
    },
    visibleText: [
      `tick ${summary.tick}`,
      `population ${summary.population}`,
      `active tool ${activeTool}`,
      summaryLine(summary),
    ],
    controls: [
      { id: 'hud:Road', label: 'Road', target: 'hud:Road', actionKinds: ['click'], enabled: true },
      { id: 'wait', label: 'Wait', actionKinds: ['wait'], enabled: true },
    ],
    state: [
      {
        label: 'sim_summary',
        audience: 'agent',
        summary: summaryLine(summary),
        value: {
          tick: summary.tick,
          population: summary.population,
          roadCells: summary.roadCells,
          activeTool,
        },
      },
      {
        label: 'recorded_findings',
        audience: 'reviewer',
        summary: `${findings.length} finding${findings.length === 1 ? '' : 's'} recorded`,
        value: findings.map((finding) => ({
          tick: finding.tick,
          area: finding.area,
          verificationStatus: finding.verificationStatus ?? null,
          nextAction: finding.nextAction ?? null,
          disposition: finding.disposition ?? null,
        })),
      },
    ],
    metadata: {
      source: 'city.dogfoodRecursiveImprovementLoop',
      step: stepIndex,
    },
  };
}

function performDogfoodAction(
  sim: CitySim,
  action: VisualPlaytestAction,
  setActiveTool: (tool: string) => void,
): VisualPlaytestActionResult {
  if (action.kind === 'click' && action.target === 'hud:Road') {
    setActiveTool('road');
    return { ok: true, action, message: 'selected Road via visual host control' };
  }
  if (action.kind === 'wait') {
    step(sim, Math.max(1, Math.round((action.durationMs ?? 250) / TICK_MS)));
    return { ok: true, action, message: `advanced ${action.durationMs ?? 250}ms` };
  }
  if (action.kind === 'stop') {
    return { ok: true, action, message: action.reason ?? 'stopped' };
  }
  return {
    ok: false,
    action,
    message: `${action.kind} is not supported by the dogfood host`,
    error: {
      name: 'UnsupportedDogfoodAction',
      message: `${action.kind} is not supported by the dogfood host`,
      stack: null,
    },
  };
}

function buildDogfoodDistrict(sim: CitySim): void {
  const origin = findLandBlock(sim, 18, 18);
  buildDistrict(sim, 'R', origin, 15);
}

function findLandBlock(sim: CitySim, w: number, h: number): { x: number; y: number } {
  for (let y = 0; y + h <= sim.terrain.height; y++) {
    for (let x = 0; x + w <= sim.terrain.width; x++) {
      let clear = true;
      for (let dy = 0; clear && dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (sim.terrain.water[cellIndex(x + dx, y + dy)] === 1) {
            clear = false;
            break;
          }
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error(`no ${w}x${h} land block found for dogfood loop`);
}

function buildDistrict(sim: CitySim, zone: ZoneType, origin: { x: number; y: number }, width: number): void {
  const y = origin.y + 2;
  submitOrThrow(sim, 'placeRoad', { ax: origin.x, ay: y, bx: origin.x + width, by: y });
  sim.world.step();
  submitOrThrow(sim, 'zone', { zone, ax: origin.x, ay: y - 2, bx: origin.x + width, by: y - 1 });
  submitOrThrow(sim, 'zone', { zone, ax: origin.x, ay: y + 1, bx: origin.x + width, by: y + 2 });
  sim.world.step();
}

function submitOrThrow<K extends keyof CityCommands>(sim: CitySim, name: K, data: CityCommands[K]): void {
  if (sim.world.submit(name, data)) return;
  // Every validator records why it refused, so quote it rather than making the
  // reader re-derive the cause from the command name alone.
  throw new Error(
    `dogfood setup command ${String(name)} ${JSON.stringify(data)} was rejected: ` +
      `${sim.lastRejection ?? 'no reason recorded'}`,
  );
}

function step(sim: CitySim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.world.step();
}

function recordedBundle(
  recorder: SessionRecorder<CityEvents, CityCommands>,
): SessionBundle<CityEvents, CityCommands> {
  return recorder.toBundle() as unknown as SessionBundle<CityEvents, CityCommands>;
}

function hasMarkerPayload(data: unknown, key: string): boolean {
  return typeof data === 'object' && data !== null && key in data;
}
