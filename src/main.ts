import { Game } from './app/game';
import { createHarness, type HarnessApi } from './harness/api';

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

const game = new Game(container);

window.render_game_to_text = () => JSON.stringify(game.getTextState());
window.advanceTime = (ms: number) => game.advanceTime(ms);
// Harness (recording, replay) is a dev/playtest tool — matches the DEV-gated
// worker recorder, so a production build carries neither.
if (import.meta.env.DEV) window.__harness = createHarness(game);
// Automation/debug backdoor for the agent playtest loop.
(window as unknown as { __game: Game }).__game = game;
