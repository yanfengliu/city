import type { LayerState, World } from 'civ-engine';

export interface Position {
  x: number;
  y: number;
}

export type ZoneType = 'R' | 'C' | 'I';

export type ServiceType = 'fireStation' | 'police' | 'clinic' | 'school';

export type PowerPlantKind = 'coal' | 'wind';

/** Overlay-subscribable field layers (coverage is separate — rebuilt on structure changes). */
export type FieldName = 'pollution' | 'noise' | 'landValue';

/** Both road commands take an L-path between two cells (dominant axis first). */
export interface RoadEndpoints {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Rectangle between two corner cells, inclusive. */
export interface RectArea {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface ZoneCommand extends RectArea {
  zone: ZoneType;
}

export interface BuildingComponent {
  zone: ZoneType;
  level: number;
  /** Anchor is the position component (top-left); footprint spans w × h cells. */
  w: number;
  h: number;
  /** Occupied residential capacity (R) — citizen entities are the source of truth; this mirrors the count. */
  residents: number;
  /** Filled job slots (C/I), phase 3+. */
  jobsFilled: number;
  abandoned: boolean;
  /** Consecutive level-evaluation streaks. */
  upEvals: number;
  badEvals: number;
  /** Separate, longer-grace streak for utilities-only problems. */
  badUtilityEvals: number;
  recoverEvals: number;
  /**
   * Utility connectivity, written by the flood-fill systems (phase 5).
   * Spawned true so pre-first-flood-fill buildings don't flash problem icons.
   */
  powered: boolean;
  watered: boolean;
}

/** Player-placed service building (2x2 footprint anchored at the position component). */
export interface StructureComponent {
  type: ServiceType;
}

export interface PlaceServiceCommand {
  service: ServiceType;
  /** Anchor cell (top-left of the 2x2 footprint). */
  x: number;
  y: number;
}

export interface PlacePowerPlantCommand {
  kind: PowerPlantKind;
  /** Anchor cell (top-left of the footprint). */
  x: number;
  y: number;
}

/** Pump anchor cell — must be orthogonally adjacent to at least one water cell. */
export interface PlaceWaterPumpCommand {
  x: number;
  y: number;
}

/** Integer percent rate within [MIN_TAX_RATE, MAX_TAX_RATE]. */
export interface SetTaxRateCommand {
  zone: ZoneType;
  rate: number;
}

/** Per-zone tax rates, integer percent. */
export interface TaxRates {
  r: number;
  c: number;
  i: number;
}

/** One budget interval's totals, emitted by the budget system. */
export interface BudgetReport {
  income: number;
  expenses: number;
  /** Commercial-tax portion earned from completed shopping visits. */
  retailIncome: number;
}

export type TripPhase = 'home' | 'toWork' | 'atWork' | 'toHome' | 'toShop' | 'atShop';

export type PedestrianPurpose = 'commercial-work' | 'industrial-work' | 'shopping';

export interface CitizenComponent {
  home: number;
  work: number | null;
  phase: TripPhase;
  /** Tick before which this citizen won't start the next trip leg. */
  waitUntil: number;
  /** Defaults to work for snapshots created before pedestrian activities. */
  nextActivity?: 'work' | 'shop';
  /** Commercial destination retained through the at-shop wait and return leg. */
  shop?: number | null;
  /** Guards the shop assignment against entity-id reuse. */
  shopGen?: number | null;
}

/** Immutable walking route; stored separately so tick diffs do not copy the path array. */
export interface PedestrianPathComponent {
  citizen: number;
  citizenGen: number;
  cells: number[];
  destination: number;
  destinationGen: number;
  purpose: PedestrianPurpose;
  outbound: boolean;
}

/** Small per-tick walking state for the segment between pathIndex and pathIndex + 1. */
export interface PedestrianComponent {
  segmentIndex: number;
  t: number;
}

export interface VehicleLeg {
  edge: number;
  /** Traverse the edge's cells array back-to-front. */
  reverse: boolean;
}

export interface VehicleComponent {
  citizen: number;
  /** Owner's entity generation at spawn — guards against id recycling. */
  citizenGen: number;
  /** Work/home entity targeted by this leg; optional only for legacy snapshots. */
  destination?: number;
  /** Destination generation at spawn; paired with destination when present. */
  destinationGen?: number;
  legs: VehicleLeg[];
  legIndex: number;
  /** Progress along the current edge in [0, 1). */
  t: number;
  toWork: boolean;
}

export interface DemandState {
  r: number;
  c: number;
  i: number;
}

// Type aliases (not interfaces) so they satisfy the engine's Record-shaped
// generic constraints structurally.
export type CityComponents = {
  position: Position;
  roadCell: Record<string, never>;
  zoneCell: { zone: ZoneType };
  building: BuildingComponent;
  citizen: CitizenComponent;
  vehicle: VehicleComponent;
  /**
   * Singleton mirror entity: sim-visible derived state that must survive
   * save/load/replay exactly (congestion buckets now; layer states in phase 4).
   * Components diff by dirty flag, so writes cost nothing between changes.
   */
  congestionMirror: { buckets: Array<[edge: number, bucket: number]> };
  structure: StructureComponent;
  /** Layer mirrors (see congestionMirror doc): written only on that layer's recompute cadence. */
  pollutionMirror: LayerState<number>;
  noiseMirror: LayerState<number>;
  landValueMirror: LayerState<number>;
  /** All four coverage layers, keyed by service; written on structure changes only. */
  coverageMirror: Record<ServiceType, LayerState<number>>;
  /** Coal plant (3x3) or wind turbine (1x1), anchored top-left at the position component. */
  powerPlant: { kind: PowerPlantKind };
  /** Power line cell marker — overhead overlay that never occupies. */
  powerLine: Record<string, never>;
  /** Pipe cell marker — underground, does NOT occupy (may sit under anything on land). */
  pipe: Record<string, never>;
  /** Water pump (1x1) marker — occupies its cell; capacity source for the water network. */
  waterPump: Record<string, never>;
  /** Appended for save/replay registration compatibility. */
  pedestrianPath: PedestrianPathComponent;
  pedestrian: PedestrianComponent;
};

export type CityCommands = {
  placeRoad: RoadEndpoints;
  bulldozeRoad: RoadEndpoints;
  zone: ZoneCommand;
  dezone: RectArea;
  bulldozeRect: RectArea;
  placeService: PlaceServiceCommand;
  placePowerPlant: PlacePowerPlantCommand;
  placePowerLine: RoadEndpoints;
  placeWaterPump: PlaceWaterPumpCommand;
  placePipe: RoadEndpoints;
  setTaxRate: SetTaxRateCommand;
};

export type CityEvents = {
  /**
   * Payload intentionally empty: event payloads are replay-compared, and the
   * derived topologyVersion counter's absolute value differs between an
   * original run and a rebuildDerived-restored replay (the worker reads
   * sim.topologyVersion directly instead).
   */
  roadsChanged: Record<string, never>;
  buildingGrown: { entity: number; zone: ZoneType };
  buildingAbandoned: { entity: number };
  buildingRecovered: { entity: number };
  zonesChanged: Record<string, never>;
  trafficChanged: Record<string, never>;
  structuresChanged: Record<string, never>;
  /** A field layer's recompute produced new values (drives overlay pushes). */
  fieldChanged: { field: FieldName };
  /** Any plant/turbine/line/pump/pipe was placed or bulldozed. */
  utilitiesChanged: Record<string, never>;
  /** One budget interval settled (income and expenses already applied). */
  budget: BudgetReport;
};

export type CityState = {
  treasury: number;
  demand: DemandState;
  population: number;
  /** Trips cancelled because no route existed (or the route vanished). */
  disconnectedTrips: number;
  /** Deterministic rotation cursor for trip candidate selection. */
  tripCursor: number;
  /** Entity id of the singleton mirror entity. */
  mirrorEntity: number;
  /** Per-zone tax rates (integer percent, default DEFAULT_TAX_RATE). */
  taxRates: TaxRates;
  /** Shopping visits awaiting the next budget settlement. */
  pendingRetailVisits: number;
  /** Lifetime completed shopping arrivals, exposed to playtest surfaces. */
  completedShoppingTrips: number;
};

export type CityWorld = World<CityEvents, CityCommands, CityComponents, CityState>;
