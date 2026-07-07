import type {
  VisualPlaytestAction,
  VisualPlaytestActionResult,
  VisualPlaytestControl,
  VisualPlaytestFinding,
  VisualPlaytestHost,
  VisualPlaytestObservation,
  VisualPlaytestStateChannel,
} from 'civ-engine';
import { TOOL_GROUPS } from '../app/tools';
import type { HarnessApi } from './api';
import { visualFindingToPlaytestFinding } from './findings';

export interface CityVisualObservationOptions {
  screenshotQuality?: number;
}

export interface CityVisualPlaytestHostOptions extends CityVisualObservationOptions {
  defaultWaitMs?: number;
}

const STATIC_HUD_LABELS = [
  'Budget',
  'Save',
  'Load',
  'New',
  'Pollution',
  'Noise',
  'Land value',
  'Traffic',
  'Power',
  'Water',
] as const;

export function cityVisualObservation(
  api: HarnessApi,
  options: CityVisualObservationOptions = {},
): VisualPlaytestObservation {
  const state = api.state();
  const findings = api.findings();
  const screenshot = api.player.screenshot(options.screenshotQuality);
  const summary = summarizeState(state);
  const channels: VisualPlaytestStateChannel[] = [
    {
      label: 'render_game_to_text',
      audience: 'agent',
      summary,
      value: toJsonValue(state),
    },
  ];
  if (findings.length > 0) {
    channels.push({
      label: 'recorded_findings',
      audience: 'reviewer',
      summary: `${findings.length} finding${findings.length === 1 ? '' : 's'} recorded`,
      value: toJsonValue(findings),
    });
  }
  if (api.lastSelfCheck) {
    channels.push({
      label: 'last_self_check',
      audience: 'traceOnly',
      summary: api.lastSelfCheck.ok ? 'last selfCheck OK' : 'last selfCheck failed',
      value: toJsonValue(api.lastSelfCheck),
    });
  }
  if (api.lastInspection) {
    channels.push({
      label: 'last_inspection',
      audience: 'traceOnly',
      summary: `last inspectAt(${api.lastInspection.tick})`,
      value: toJsonValue(api.lastInspection),
    });
  }

  return {
    screenshot: {
      dataUrl: screenshot,
      mime: mimeFromDataUrl(screenshot),
      ...canvasViewport(),
      alt: 'City playtest browser screenshot',
    },
    visibleText: visibleTextFromState(state),
    controls: cityVisualControls(),
    state: channels,
    metadata: toJsonValue({ source: 'city.__harness', findingCount: findings.length }),
  };
}

export function createCityVisualPlaytestHost(
  api: HarnessApi,
  options: CityVisualPlaytestHostOptions = {},
): VisualPlaytestHost {
  return {
    observe: () => cityVisualObservation(api, options),
    performAction: (action) => performCityVisualAction(api, action, options),
    annotate: (finding: VisualPlaytestFinding) => {
      api.annotate(visualFindingToPlaytestFinding(finding));
    },
  };
}

function performCityVisualAction(
  api: HarnessApi,
  action: VisualPlaytestAction,
  options: CityVisualPlaytestHostOptions,
): VisualPlaytestActionResult {
  switch (action.kind) {
    case 'click':
      return click(api, action);
    case 'drag':
      api.player.dragAt(action.from.x, action.from.y, action.to.x, action.to.y);
      return ok(action, 'dragged on player surface');
    case 'key':
      if (action.modifiers?.length) {
        return fail(action, `key modifiers are not supported by city player.key: ${action.modifiers.join('+')}`);
      }
      api.player.key(action.key);
      return ok(action, `pressed ${action.key}`);
    case 'wait': {
      const duration = Math.max(0, Math.round(action.durationMs ?? options.defaultWaitMs ?? 250));
      api.advance(duration);
      return ok(action, `advanced ${duration}ms`);
    }
    case 'stop':
      return ok(action, action.reason ?? 'stopped');
    default:
      return fail(action, `${action.kind} is not supported by the city harness adapter`);
  }
}

function click(
  api: HarnessApi,
  action: Extract<VisualPlaytestAction, { kind: 'click' }>,
): VisualPlaytestActionResult {
  const target = action.target ?? (action.label ? `hud:${action.label}` : undefined);
  if (target?.startsWith('hud:')) {
    const label = target.slice('hud:'.length);
    const matched = api.player.hud(label);
    return matched ? ok(action, `clicked HUD ${label}`) : fail(action, `HUD target not found: ${label}`);
  }
  if (action.point) {
    const button = action.button ?? 'left';
    if (button === 'left') {
      api.player.clickAt(action.point.x, action.point.y);
    } else {
      api.player.dragAt(action.point.x, action.point.y, action.point.x, action.point.y, buttonNumber(button));
    }
    return ok(action, `clicked ${button} at ${action.point.x},${action.point.y}`);
  }
  return fail(action, 'click needs either target hud:<label> or point');
}

function cityVisualControls(): VisualPlaytestControl[] {
  const controls = new Map<string, VisualPlaytestControl>();
  controls.set('canvas', {
    id: 'canvas',
    label: 'Map/canvas',
    target: 'canvas',
    actionKinds: ['click', 'drag', 'wheel'],
    bounds: canvasBounds(),
    description: 'Map surface for cell clicks, drags, camera orbit/pan, and zoom.',
  });
  controls.set('keyboard', {
    id: 'keyboard',
    label: 'Keyboard',
    actionKinds: ['key'],
    description: 'Tool shortcuts, camera WASD, Escape, and Space speed toggle.',
  });

  for (const control of hudControlsFromDom()) controls.set(control.target ?? control.label, control);
  for (const control of fallbackHudControls()) {
    if (!controls.has(control.target ?? control.label)) controls.set(control.target ?? control.label, control);
  }
  return [...controls.values()];
}

function hudControlsFromDom(): VisualPlaytestControl[] {
  if (typeof document === 'undefined') return [];
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .map((button, index): VisualPlaytestControl | null => {
      const label = canonicalHudLabel(normalizeWhitespace(button.textContent ?? ''));
      if (!label) return null;
      const rect = button.getBoundingClientRect();
      return {
        id: `hud:${index}`,
        label,
        target: `hud:${label}`,
        actionKinds: ['click'],
        enabled: !button.disabled,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        ...(button.title ? { description: button.title } : {}),
      };
    })
    .filter((control): control is VisualPlaytestControl => control !== null);
}

function fallbackHudControls(): VisualPlaytestControl[] {
  return fallbackHudLabels().map((label) => ({
    label,
    target: `hud:${label}`,
    actionKinds: ['click'],
  }));
}

function fallbackHudLabels(): string[] {
  const labels = new Set<string>();
  for (const group of TOOL_GROUPS) {
    for (const tool of group) labels.add(tool.label);
  }
  for (const label of STATIC_HUD_LABELS) labels.add(label);
  return [...labels];
}

function canonicalHudLabel(raw: string): string {
  const labels = fallbackHudLabels().sort((a, b) => b.length - a.length);
  return labels.find((label) => raw === label || raw.startsWith(label) || raw.includes(label)) ?? raw;
}

function visibleTextFromState(state: Record<string, unknown>): string[] {
  const out: string[] = [];
  add(out, 'tick', state.tick);
  add(out, 'day', state.day);
  add(out, 'treasury', state.treasury);
  add(out, 'population', state.populationPeople);
  add(out, 'active tool', state.activeTool);
  add(out, 'active overlay', state.activeOverlay);
  add(out, 'road cells', state.roadCellCount);
  add(out, 'buildings', state.buildingCount);
  add(out, 'vehicles', state.vehiclesOnScreen);
  const advisories = state.advisories;
  if (Array.isArray(advisories)) {
    for (const advisory of advisories) {
      if (typeof advisory === 'string') out.push(advisory);
      else if (isRecord(advisory) && typeof advisory.text === 'string') out.push(advisory.text);
    }
  }
  return out;
}

function summarizeState(state: Record<string, unknown>): string {
  return visibleTextFromState(state).slice(0, 8).join('; ');
}

function add(out: string[], label: string, value: unknown): void {
  if (value === undefined || value === null) return;
  out.push(`${label} ${String(value)}`);
}

function ok(action: VisualPlaytestAction, message: string): VisualPlaytestActionResult {
  return { ok: true, action, message };
}

function fail(action: VisualPlaytestAction, message: string): VisualPlaytestActionResult {
  return {
    ok: false,
    action,
    message,
    error: { name: 'UnsupportedCityVisualAction', message, stack: null },
  };
}

function buttonNumber(button: 'left' | 'middle' | 'right'): number {
  if (button === 'middle') return 1;
  if (button === 'right') return 2;
  return 0;
}

function mimeFromDataUrl(value: string): string | undefined {
  const match = /^data:([^;,]+)/.exec(value);
  return match?.[1];
}

function canvasViewport(): Pick<NonNullable<VisualPlaytestObservation['screenshot']>, 'width' | 'height'> {
  if (typeof document === 'undefined') return {};
  const canvas = document.querySelector('canvas');
  if (!canvas) return {};
  return { width: canvas.width, height: canvas.height };
}

function canvasBounds(): VisualPlaytestControl['bounds'] {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.querySelector('canvas');
  if (!canvas) return undefined;
  const rect = canvas.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toJsonValue(value: unknown): VisualPlaytestStateChannel['value'] {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as VisualPlaytestStateChannel['value'];
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
