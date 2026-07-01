/** Typed messages between the main thread and the sim worker. All payloads must be structured-clone-safe plain data. */

export type GameSpeed = 0 | 1 | 2 | 4;

export type ClientToWorker =
  | { type: 'setSpeed'; speed: GameSpeed }
  /** Automation/testing: synchronously step N ticks regardless of speed. */
  | { type: 'advance'; ticks: number };

export interface FrameStats {
  population: number;
  treasury: number;
}

export type WorkerToClient =
  | { type: 'ready'; gridWidth: number; gridHeight: number; seed: number }
  | { type: 'frame'; tick: number; speed: GameSpeed; stats: FrameStats };
