import type { LayerState, World } from 'civ-engine';

export interface Position {
  x: number;
  y: number;
}

export type ZoneType = 'R' | 'C' | 'I';

export type ServiceType = 'fireStation' | 'police' | 'clinic' | 'school';

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

export type TripPhase = 'home' | 'toWork' | 'atWork' | 'toHome';

export interface CitizenComponent {
  home: number;
  work: number | null;
  phase: TripPhase;
  /** Tick before which this citizen won't start the next trip leg. */
  waitUntil: number;
}

export interface VehicleLeg {
  edge: number;
  /** Traverse the edge's cells array back-to-front. */
  reverse: boolean;
}

export interface VehicleComponent {
  citizen: number;
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
};

export type CityCommands = {
  placeRoad: RoadEndpoints;
  bulldozeRoad: RoadEndpoints;
  zone: ZoneCommand;
  dezone: RectArea;
  bulldozeRect: RectArea;
  placeService: PlaceServiceCommand;
};

export type CityEvents = {
  roadsChanged: { topologyVersion: number };
  buildingGrown: { entity: number; zone: ZoneType };
  buildingAbandoned: { entity: number };
  buildingRecovered: { entity: number };
  zonesChanged: Record<string, never>;
  trafficChanged: Record<string, never>;
  structuresChanged: Record<string, never>;
  /** A field layer's recompute produced new values (drives overlay pushes). */
  fieldChanged: { field: FieldName };
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
};

export type CityWorld = World<CityEvents, CityCommands, CityComponents, CityState>;
