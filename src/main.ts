import { Game } from './app/game';

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (ms: number) => void;
  }
}

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');

const game = new Game(container);

window.render_game_to_text = () => JSON.stringify(game.getTextState());
window.advanceTime = (ms: number) => game.advanceTime(ms);
