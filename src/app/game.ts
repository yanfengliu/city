import { CityScene } from '../rendering/scene';
import { Hud } from '../ui/hud';
import { TICK_MS } from '../sim/constants/map';
import type { ClientToWorker, GameSpeed, WorkerToClient } from '../protocol/messages';

/** Composition root: wires the sim worker, renderer, and HUD together. */
export class Game {
  private readonly worker: Worker;
  private readonly scene: CityScene;
  private readonly hud: Hud;
  private tick = 0;
  private speed: GameSpeed = 1;
  private ready = false;

  constructor(container: HTMLElement) {
    this.scene = new CityScene(container);
    this.hud = new Hud(container, (speed) => this.setSpeed(speed));
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerToClient>) => {
      this.onWorkerMessage(event.data);
    });
    setInterval(() => {
      this.hud.update({ tick: this.tick, fps: this.scene.getFps(), speed: this.speed });
    }, 250);
  }

  private send(message: ClientToWorker): void {
    this.worker.postMessage(message);
  }

  private onWorkerMessage(message: WorkerToClient): void {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        break;
      case 'frame':
        this.tick = message.tick;
        break;
    }
  }

  setSpeed(speed: GameSpeed): void {
    this.speed = speed;
    this.send({ type: 'setSpeed', speed });
  }

  /** Automation hook: advance the sim by wall-clock-equivalent ms at 1x. */
  advanceTime(ms: number): void {
    this.send({ type: 'advance', ticks: Math.max(1, Math.round(ms / TICK_MS)) });
  }

  /** Automation hook: coarse machine-readable game state. */
  getTextState(): Record<string, unknown> {
    return {
      ready: this.ready,
      tick: this.tick,
      speed: this.speed,
      fps: this.scene.getFps(),
    };
  }
}
