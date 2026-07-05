import type { Game } from '../app/game';
import type { CommandName } from '../protocol/messages';
import type { CityCommands } from '../sim/types';
import type { SimSummary } from '../sim/summary';
import type { PlaytestFinding, RecordedFinding } from './findings';
import type { SelfCheckSummary } from './inspect';
import type { PlayerInput } from './player';

/**
 * `window.__harness` — the LLM playtest surface (see docs/harness.md). Drive
 * the game, annotate findings, then replay/inspect for debugging. The async
 * methods both return a Promise and stash their result on `last*`, so an
 * automation eval can trigger then read the stash a beat later.
 */
export interface HarnessApi {
  /**
   * See + control the game exactly as a player does — screenshot, real pointer
   * events on the canvas, keyboard, and HUD button clicks (vs. `command`, which
   * bypasses the UI). Use this to playtest the actual player experience.
   */
  player: PlayerInput;
  /** Bounded machine-readable game state (alias of render_game_to_text). */
  state(): Record<string, unknown>;
  /** Step the sim forward by wall-clock-equivalent ms at 1x. */
  advance(ms: number): void;
  /** Submit any sim command by name. */
  command<K extends CommandName>(name: K, data: CityCommands[K]): void;
  /** Record a finding as a marker at the current tick. */
  annotate(finding: Partial<PlaytestFinding>): void;
  /** Findings recorded this session. */
  findings(): readonly RecordedFinding[];
  /** Replay to `tick` and resolve the exact deterministic state there (null summary on failure). */
  inspectAt(tick: number): Promise<{ tick: number; summary: SimSummary | null; error?: string }>;
  /** Verify the recorded session replays identically (null on failure). */
  selfCheck(): Promise<SelfCheckSummary | null>;
  /** Export the recorded, annotated session bundle. */
  getBundle(): Promise<{ bundle: unknown; findings: RecordedFinding[] }>;
  readonly lastInspection: { tick: number; summary: SimSummary | null } | undefined;
  readonly lastSelfCheck: SelfCheckSummary | undefined;
  readonly lastBundle: { bundle: unknown; findings: RecordedFinding[] } | undefined;
}

export function createHarness(game: Game): HarnessApi {
  return {
    player: game.playerInput(),
    state: () => game.getTextState(),
    advance: (ms) => game.advanceTime(ms),
    command: (name, data) => game.harnessCommand(name, data),
    annotate: (finding) => game.annotate(finding),
    findings: () => game.harnessFindingsList(),
    inspectAt: (tick) => game.inspectAt(tick),
    selfCheck: () => game.requestSelfCheck(),
    getBundle: () => game.requestBundle(),
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
}
