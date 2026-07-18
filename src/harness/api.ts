import type { Game } from '../app/game';
import type { CommandName } from '../protocol/messages';
import type { CityCommands } from '../sim/types';
import type { SimSummary } from '../sim/summary';
import type { VisualPlaytestHost } from 'civ-engine';
import type { CityImprovementFindingInput, RecordedFinding } from './findings';
import type { SelfCheckSummary } from './inspect';
import type { PlayerInput } from './player';
import { createCityVisualPlaytestHost } from './visual';

/**
 * `window.__harness` — the LLM playtest surface (see docs/harness.md). Drive
 * the game, annotate findings, then replay/inspect for debugging. The async
 * methods both return a Promise and stash their result on `last*`, so an
 * automation eval can trigger then read the stash a beat later.
 */
export interface HarnessApi {
  /**
   * Observe the map canvas and drive UI handlers with synthetic pointer/key
   * events and HUD element clicks (vs. `command`, which bypasses the UI).
   * Full browser playtests cover trusted input, hit-testing, and DOM compositing.
   */
  player: PlayerInput;
  /** Bounded machine-readable game state (alias of render_game_to_text). */
  state(): Record<string, unknown>;
  /** Step the sim forward by wall-clock-equivalent ms at 1x. */
  advance(ms: number): void;
  /**
   * Submit any sim command by name. Fire-and-forget: the worker answers
   * asynchronously, so a refusal surfaces on the next observation rather than
   * here. Read `state().lastCommandSubmission` for `{accepted, message, tick}`
   * — `message` carries the specific reason (AGENTS.md: error messages are a
   * product surface), e.g. `(45, 31) is water — build on dry land`.
   */
  command<K extends CommandName>(name: K, data: CityCommands[K]): void;
  /** Record a standardized recursive-loop finding as a marker at the current tick. */
  annotate(finding: Partial<CityImprovementFindingInput>): void;
  /** Findings recorded this session. */
  findings(): readonly RecordedFinding[];
  /** Replay to `tick` and resolve the exact deterministic state there (null summary on failure). */
  inspectAt(tick: number): Promise<{ tick: number; summary: SimSummary | null; error?: string }>;
  /** Verify the recorded session replays identically (null on failure). */
  selfCheck(): Promise<SelfCheckSummary | null>;
  /** Export the recorded, annotated session bundle. */
  getBundle(): Promise<{ bundle: unknown; findings: RecordedFinding[] }>;
  /** Adapter for civ-engine's generic visual playtest loop. */
  visualHost(): VisualPlaytestHost;
  readonly lastInspection: { tick: number; summary: SimSummary | null } | undefined;
  readonly lastSelfCheck: SelfCheckSummary | undefined;
  readonly lastBundle: { bundle: unknown; findings: RecordedFinding[] } | undefined;
}

export function createHarness(game: Game): HarnessApi {
  const harness: HarnessApi = {
    player: game.playerInput(),
    state: () => game.getTextState(),
    advance: (ms) => game.advanceTime(ms),
    command: (name, data) => game.harnessCommand(name, data),
    annotate: (finding) => game.annotate(finding),
    findings: () => game.harnessFindingsList(),
    inspectAt: (tick) => game.inspectAt(tick),
    selfCheck: () => game.requestSelfCheck(),
    getBundle: () => game.requestBundle(),
    visualHost: () => createCityVisualPlaytestHost(harness),
    get lastInspection() {
      return game.lastInspection;
    },
    get lastSelfCheck() {
      return game.lastSelfCheck;
    },
    get lastBundle() {
      return game.lastBundle;
    },
  };
  return harness;
}
