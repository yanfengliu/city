import { Game } from './app/game';
import { createHarness, type HarnessApi } from './harness/api';
import { playtestRecordingRequested } from './harness/recording-mode';

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (ms: number) => void;
    /** LLM playtest → annotate → replay harness (dev only; see docs/harness.md). */
    __harness?: HarnessApi;
  }
}

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');

const recordPlaytest = import.meta.env.DEV && playtestRecordingRequested(location.search);
const game = new Game(container, { recordPlaytest });

window.render_game_to_text = () => JSON.stringify(game.getTextState());
window.advanceTime = (ms: number) => game.advanceTime(ms);
// Harness (recording, replay) is a dev/playtest tool — matches the DEV-gated
// worker recorder and requires ?record=1, so ordinary localhost play stays lean
// and a production build carries neither.
if (recordPlaytest) window.__harness = createHarness(game);
// Automation/debug backdoor for the agent playtest loop.
(window as unknown as { __game: Game }).__game = game;
