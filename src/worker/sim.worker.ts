import { createCityWorld } from '../sim/world-factory';
import { GRID_HEIGHT, GRID_WIDTH, TICK_MS } from '../sim/constants/map';
import type { ClientToWorker, GameSpeed, WorkerToClient } from '../protocol/messages';

const workerScope = self as unknown as {
  postMessage(message: WorkerToClient): void;
};

function post(message: WorkerToClient): void {
  workerScope.postMessage(message);
}

const seed = 12345;
const world = createCityWorld({ seed });

let speed: GameSpeed = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

function stepOnce(): void {
  world.step();
  post({
    type: 'frame',
    tick: world.tick,
    speed,
    stats: { population: 0, treasury: 0 },
  });
}

/**
 * Fixed-timestep setTimeout chain. civ-engine ships a GameLoop but does not
 * export it from its public index, so the worker owns this small loop.
 */
function schedule(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (speed === 0) return;
  timer = setTimeout(() => {
    stepOnce();
    schedule();
  }, TICK_MS / speed);
}

addEventListener('message', (event) => {
  const message = (event as MessageEvent<ClientToWorker>).data;
  switch (message.type) {
    case 'setSpeed':
      speed = message.speed;
      schedule();
      break;
    case 'advance': {
      for (let i = 0; i < message.ticks; i++) stepOnce();
      break;
    }
  }
});

post({ type: 'ready', gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT, seed });
schedule();
