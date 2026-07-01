import type { CityCommands, DemandState, ZoneType } from '../sim/types';

/** Typed messages between the main thread and the sim worker. All payloads must be structured-clone-safe plain data. */

export type GameSpeed = 0 | 1 | 2 | 4;

export type CommandName = keyof CityCommands;

export type CommandMessage = {
  [K in CommandName]: { type: 'command'; name: K; data: CityCommands[K] };
}[CommandName];

export type ClientToWorker =
  | CommandMessage
  | { type: 'setSpeed'; speed: GameSpeed }
  /** Automation/testing: synchronously step N ticks regardless of speed. */
  | { type: 'advance'; ticks: number };

export interface TerrainPayload {
  width: number;
  height: number;
  /** 1 = water, per cell index. */
  water: Uint8Array;
  /** 1 = decorative tree, per cell index. */
  trees: Uint8Array;
}

export interface RoadEdgePayload {
  id: number;
  /** Node cell indices at each end. */
  a: number;
  b: number;
  /** Path cell indices from a to b inclusive. */
  cells: number[];
}

export interface FrameStats {
  /** Citizen entities (households) — UI multiplies by PEOPLE_PER_CITIZEN for display. */
  citizens: number;
  treasury: number;
  demand: DemandState;
}

export interface BuildingView {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'rci';
  zone: ZoneType;
  level: number;
  abandoned: boolean;
}

export type WorkerToClient =
  | {
      type: 'ready';
      gridWidth: number;
      gridHeight: number;
      seed: number;
      terrain: TerrainPayload;
    }
  | { type: 'frame'; tick: number; speed: GameSpeed; stats: FrameStats }
  | {
      type: 'roads';
      topologyVersion: number;
      cells: number[];
      edges: RoadEdgePayload[];
    }
  | { type: 'zones'; cells: Array<{ i: number; zone: ZoneType }> }
  | { type: 'buildings'; upserts: BuildingView[]; removed: number[] }
  | { type: 'commandRejected'; name: CommandName; message: string };
