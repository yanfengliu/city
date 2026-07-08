import { describe, expect, it } from 'vitest';
import { runVisualPlaytestLoop, type VisualPlaytestDecision } from 'civ-engine';
import {
  cityVisualObservation,
  createCityVisualPlaytestHost,
} from '../../src/harness/visual';
import type { HarnessApi } from '../../src/harness/api';
import {
  recordedFindingFromCityFinding,
  type CityImprovementFindingInput,
  type RecordedFinding,
} from '../../src/harness/findings';
import type { SelfCheckSummary } from '../../src/harness/inspect';
import type { PlayerInput } from '../../src/harness/player';
import type { CommandName } from '../../src/protocol/messages';
import type { CityCommands } from '../../src/sim/types';

function stubHarness() {
  const calls = {
    hud: [] as string[],
    clickAt: [] as Array<[number, number]>,
    dragAt: [] as Array<[number, number, number, number, number | undefined]>,
    key: [] as string[],
    advance: [] as number[],
    command: [] as string[],
    annotate: [] as Partial<CityImprovementFindingInput>[],
  };
  const player: PlayerInput = {
    screenshot: () => 'data:image/jpeg;base64,abc123',
    where: (x, y) => ({ sx: x + 0.5, sy: y + 0.5, onScreen: true }),
    cellAt: (sx, sy) => ({ x: Math.floor(sx), y: Math.floor(sy) }),
    dragMap: () => {},
    tapMap: () => {},
    clickAt: (sx, sy) => calls.clickAt.push([sx, sy]),
    dragAt: (sx1, sy1, sx2, sy2, button) => calls.dragAt.push([sx1, sy1, sx2, sy2, button]),
    key: (k) => calls.key.push(k),
    hud: (label) => {
      calls.hud.push(label);
      return label === 'Road';
    },
  };
  const findings: RecordedFinding[] = [
    recordedFindingFromCityFinding(
      {
        category: 'visual',
        severity: 'low',
        area: 'roads',
        observed: 'Road preview is faint',
      },
      3,
    ),
  ];
  const api: HarnessApi = {
    player,
    state: () => ({
      ready: true,
      tick: 3,
      populationPeople: 12,
      treasury: 19800,
      activeTool: 'select',
      activeOverlay: 'none',
      advisories: ['Build a road to the highway'],
      cameraTarget: { x: 64, y: 0, z: 64 },
    }),
    advance: (ms) => calls.advance.push(ms),
    command: <K extends CommandName>(_name: K, _data: CityCommands[K]) => {
      calls.command.push(String(_name));
    },
    annotate: (finding) => calls.annotate.push(finding),
    findings: () => findings,
    inspectAt: async (tick) => ({ tick, summary: null }),
    selfCheck: async () => ({ ok: true, checkedSegments: 1 } as SelfCheckSummary),
    getBundle: async () => ({ bundle: {}, findings }),
    get lastInspection() {
      return undefined;
    },
    get lastSelfCheck() {
      return undefined;
    },
    get lastBundle() {
      return undefined;
    },
    visualHost: () => createCityVisualPlaytestHost(api),
  };
  return { api, calls };
}

describe('city visual playtest host', () => {
  it('builds a visual observation from the existing harness surface', () => {
    const { api } = stubHarness();

    const observation = cityVisualObservation(api);

    expect(observation.screenshot).toMatchObject({
      dataUrl: 'data:image/jpeg;base64,abc123',
      mime: 'image/jpeg',
    });
    expect(observation.visibleText).toContain('tick 3');
    expect(observation.visibleText).toContain('population 12');
    expect(observation.visibleText).toContain('Build a road to the highway');
    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Road', target: 'hud:Road', actionKinds: ['click'] }),
        expect.objectContaining({ label: 'Map/canvas', target: 'canvas' }),
      ]),
    );
    expect(observation.state).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'render_game_to_text',
          audience: 'agent',
          summary: expect.stringContaining('tick 3'),
          value: expect.objectContaining({ tick: 3 }),
        }),
        expect.objectContaining({
          label: 'recorded_findings',
          audience: 'reviewer',
          summary: '1 finding recorded',
        }),
      ]),
    );
  });

  it('advertises only supported canvas action kinds', () => {
    const { api } = stubHarness();

    const observation = cityVisualObservation(api);
    const canvas = observation.controls?.find((control) => control.target === 'canvas');

    expect(canvas?.actionKinds).toEqual(['click', 'drag']);
  });

  it('normalizes DOM tool button labels before exposing hud targets', () => {
    const { api } = stubHarness();
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        querySelectorAll: (selector: string) =>
          selector === 'button'
            ? [
                {
                  textContent: 'RoadQ',
                  title: 'Shortcut: Q',
                  disabled: false,
                  getBoundingClientRect: () => ({ x: 1, y: 2, width: 80, height: 24 }),
                },
              ]
            : [],
        querySelector: (selector: string) =>
          selector === 'canvas'
            ? {
                width: 800,
                height: 600,
                getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
              }
            : null,
      },
    });
    try {
      const observation = cityVisualObservation(api);
      const targets = observation.controls?.map((control) => control.target);
      expect(targets).toContain('hud:Road');
      expect(targets).not.toContain('hud:RoadQ');
    } finally {
      if (originalDocument === undefined) {
        delete (globalThis as { document?: Document }).document;
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        });
      }
    }
  });

  it('runs through the civ-engine loop using player controls instead of the command backdoor', async () => {
    const { api, calls } = stubHarness();
    const host = createCityVisualPlaytestHost(api);
    const decision: VisualPlaytestDecision = {
      findings: [
        {
          title: 'Road button visible',
          severity: 'low',
          category: 'usability',
          area: 'hud',
          observed: 'The Road control is available in the HUD',
          suggestion: 'Keep it exposed for new players',
        },
      ],
      actions: [
        { kind: 'click', target: 'hud:Road' },
        { kind: 'click', point: { x: 10, y: 20 } },
        { kind: 'drag', from: { x: 10, y: 20 }, to: { x: 40, y: 50 } },
        { kind: 'key', key: 'q' },
        { kind: 'wait', durationMs: 100 },
        { kind: 'stop', reason: 'done' },
      ],
    };

    const result = await runVisualPlaytestLoop({
      host,
      maxSteps: 1,
      agent: { decide: () => decision },
      traceObservation: 'full',
    });

    expect(result.ok).toBe(true);
    expect(result.stopReason).toBe('agentStop');
    expect(calls.hud).toEqual(['Road']);
    expect(calls.clickAt).toEqual([[10, 20]]);
    expect(calls.dragAt).toEqual([[10, 20, 40, 50, undefined]]);
    expect(calls.key).toEqual(['q']);
    expect(calls.advance).toEqual([100]);
    expect(calls.command).toEqual([]);
    expect(calls.annotate).toEqual([
      expect.objectContaining({
        category: 'ux',
        severity: 'low',
        area: 'hud',
        observed: 'The Road control is available in the HUD',
        suggestion: 'Keep it exposed for new players',
      }),
    ]);
  });
});
