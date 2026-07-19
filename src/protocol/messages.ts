import type {
  BudgetReport,
  CityCommands,
  DemandState,
  OverlayFieldName,
  PedestrianPurpose,
  PowerPlantKind,
  ServiceType,
  TaxRates,
  ZoneType,
} from '../sim/types';
export type { PedestrianPurpose } from '../sim/types';
import type { CityImprovementFindingInput, RecordedFinding } from '../harness/findings';
import type { SelfCheckSummary } from '../harness/inspect';
import type { SimSummary } from '../sim/summary';
import type { CitizenDetail } from '../sim/citizen-detail';
export type {
  CitizenActivityPlace,
  CitizenAgent,
  CitizenDetail,
  CitizenPlace,
} from '../sim/citizen-detail';
export type { HappinessBreakdown, HappinessFactor, HappinessFactorId } from '../sim/happiness';
export type { CitizenActivity, TripPhase } from '../sim/types';

/** Typed messages between the main thread and the sim worker. All payloads must be structured-clone-safe plain data. */

export type GameSpeed = 0 | 1 | 2 | 4;

/** ECS identity guarded against entity-id reuse. */
export interface EntityRef {
  id: number;
  generation: number;
}

/** One persistent person inside a household entity. */
export interface CitizenMemberRef extends EntityRef {
  memberId: number;
}

export type CommandName = keyof CityCommands;

export type CommandMessage = {
  [K in CommandName]: { type: 'command'; id?: number; name: K; data: CityCommands[K] };
}[CommandName];

export interface SaveMeta {
  saveVersion: 1;
  seed: number;
}

export type ClientToWorker =
  | CommandMessage
  | { type: 'setSpeed'; speed: GameSpeed }
  /** Automation/testing: synchronously step N ticks regardless of speed. */
  | { type: 'advance'; ticks: number }
  | { type: 'requestSnapshot' }
  /** Rebuilds the sim from a saved snapshot, then re-runs the full boot sync. */
  | { type: 'loadSnapshot'; snapshot: unknown; meta: SaveMeta }
  /** Replaces the set of field overlays the client wants pushed on recompute. */
  | { type: 'setFieldSubscriptions'; fields: OverlayFieldName[] }
  /** Playtest harness (see docs/harness.md): record a finding as a marker at
   * the current tick. */
  | { type: 'annotate'; finding: CityImprovementFindingInput }
  /** Export the recorded session bundle (with findings). `id` correlates the reply. */
  | { type: 'requestBundle'; id: number }
  /** Replay the recorded session to `tick` and return the exact state there. */
  | { type: 'inspectAt'; id: number; tick: number }
  /** Verify the recorded session replays identically (3-stream check). */
  | { type: 'selfCheck'; id: number }
  /**
   * One selected member plus their household context. On-demand by design:
   * profiles are never streamed, so this costs nothing until the player clicks
   * a walker or drills into a home. `id` correlates the reply.
   */
  | {
      type: 'inspectCitizen';
      id: number;
      entity: number;
      generation: number;
      memberId: number;
    }
  /**
   * Picks one person living in a residential building without streaming every
   * resident id with each building diff. The paired cursor cycles people in
   * canonical household-id/member-id order.
   */
  | {
      type: 'inspectHomeResident';
      id: number;
      building: number;
      buildingGeneration: number;
      afterCitizen?: number;
      afterCitizenGeneration?: number;
      afterMemberId?: number;
    };

export interface TerrainPayload {
  width: number;
  height: number;
  /** Normalized deterministic elevation in [0,1], per cell index. */
  elevation: Float32Array;
  /** Normalized waterline used by the presentation-only relief curve. */
  seaLevel: number;
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
  vehicles: number;
  pedestrians: number;
  employed: number;
  completedShoppingTrips: number;
  disconnectedTrips: number;
  taxRates: TaxRates;
  /** Latest budget interval's totals; {income: 0, expenses: 0} before the first. */
  lastBudget: BudgetReport;
  /** Installed capacity vs total building load — the "add a plant" vs "wire it
   * up" signal. demand counts every building (abandoned included). */
  power: { supply: number; demand: number };
  water: { supply: number; demand: number };
}

export interface VehicleView {
  id: number;
  /** ECS incarnation; a recycled id starts a new presentation identity. */
  generation: number;
  /** Current edge id in the road graph (see the `roads` message edges). */
  edge: number;
  /** Progress along the edge in [0,1). */
  t: number;
  /** Traversing the edge's cell array back-to-front. */
  reverse: boolean;
}

export interface BuildingView {
  id: number;
  /** ECS incarnation; selection must not follow a recycled entity id. */
  generation: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'rci';
  zone: ZoneType;
  level: number;
  abandoned: boolean;
  /** Citizen entities housed (R). */
  residents: number;
  /** Job slots filled (C/I), phase 3+. */
  jobsFilled: number;
  /** Utility connectivity (phase 5) — false drives the ⚡/💧 problem icons. */
  powered: boolean;
  watered: boolean;
  /**
   * Progress toward utility abandonment in 0-1 (`badUtilityEvals` over its
   * threshold). Lets the utility overlays separate "just lost power" from
   * "about to be abandoned" without shipping sim constants to the renderer.
   */
  utilityDistress: number;
}

export interface StructureView {
  id: number;
  /** ECS incarnation; selection must not follow a recycled entity id. */
  generation: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'service';
  service: ServiceType;
}

/** One walker's current road-cell segment; long routes remain worker-local. */
export interface PedestrianView {
  id: number;
  generation: number;
  /**
   * The household entity this walker belongs to. Always populated by the
   * worker and paired with generation/memberId below.
   */
  citizen: number;
  /** Owner incarnation, paired with `citizen` for a safe inspection query. */
  citizenGeneration: number;
  /** Stable member within the household who is making this trip. */
  memberId: number;
  fromCell: number;
  toCell: number;
  t: number;
  purpose: PedestrianPurpose;
  outbound: boolean;
}

/** One levelled utility footprint within the flattened `plantCells` set. */
export interface PowerPlantFootprintView {
  kind: PowerPlantKind;
  x: number;
  y: number;
  w: number;
  h: number;
  cells: number[];
}

export interface PowerNetworkView {
  plants: PowerPlantFootprintView[];
  plantCells: number[];
  lineCells: number[];
}

export interface WaterNetworkView {
  pumpCells: number[];
  pipeCells: number[];
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
  | { type: 'vehicles'; topologyVersion: number; list: VehicleView[] }
  | { type: 'pedestrians'; list: PedestrianView[] }
  | { type: 'traffic'; edges: Array<{ id: number; bucket: number }> }
  | { type: 'structures'; upserts: StructureView[]; removed: number[] }
  /**
   * Full utility-network geometry (cell indices), posted whenever any
   * plant/turbine/line/pump/pipe is placed or bulldozed.
   */
  | {
      type: 'networks';
      power: PowerNetworkView;
      water: WaterNetworkView;
    }
  /**
   * Sparse field snapshot, pushed on each subscribed field's recompute and on
   * subscription change. width/height are the layer's cell-grid dimensions
   * (each cell covers blockSize x blockSize world cells); cells absent from
   * `cells` hold `defaultValue`.
   */
  | {
      type: 'field';
      name: OverlayFieldName;
      blockSize: number;
      width: number;
      height: number;
      defaultValue: number;
      cells: Array<[index: number, value: number]>;
    }
  | {
      /** Validation-time queue admission; installed state remains authoritative. */
      type: 'commandSubmissionResult';
      id: number;
      name: CommandName;
      accepted: boolean;
      message: string;
      tick: number;
    }
  /**
   * The simulation halted and will not tick again. The engine traps the throw
   * inside the worker, so this is the only signal the city is dead rather than
   * merely paused (AGENTS.md: error messages are a product surface).
   */
  | { type: 'simFailure'; tick: number; message: string }
  /** Save response: the serialized world + metadata for persistence. */
  | { type: 'snapshot'; snapshot: unknown; meta: SaveMeta }
  /** Harness: a finding was recorded, anchored to `tick`. */
  | { type: 'annotated'; tick: number; finding: CityImprovementFindingInput }
  /** Harness: the exported session bundle + its findings (`id` correlates the request). */
  | { type: 'bundle'; id: number; bundle: unknown; findings: RecordedFinding[] }
  /** Harness: 3-stream determinism self-check result (null + error on failure). */
  | { type: 'selfCheckResult'; id: number; result: SelfCheckSummary | null; error?: string }
  /** Harness: ground-truth city state replayed to `tick` (null + error on failure). */
  | { type: 'inspection'; id: number; tick: number; summary: SimSummary | null; error?: string }
  /**
   * One household's full detail (null + a reason naming the entity when it is
   * not a citizen). `id` correlates the `inspectCitizen` request.
   */
  | {
      type: 'citizenDetail';
      id: number;
      /** Null only when a residential-building query found no household. */
      entity: number | null;
      generation: number | null;
      detail: CitizenDetail | null;
      /** Present when the household was reached through a residential building. */
      residentContext?: {
        building: EntityRef;
        index: number;
        total: number;
      };
      error?: string;
    };
