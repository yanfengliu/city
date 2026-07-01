import type { World } from 'civ-engine';

export interface Position {
  x: number;
  y: number;
}

export type ZoneType = 'R' | 'C' | 'I';

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

export interface CitizenComponent {
  home: number;
  work: number | null;
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
};

export type CityCommands = {
  placeRoad: RoadEndpoints;
  bulldozeRoad: RoadEndpoints;
  zone: ZoneCommand;
  dezone: RectArea;
  bulldozeRect: RectArea;
};

export type CityEvents = {
  roadsChanged: { topologyVersion: number };
  buildingGrown: { entity: number; zone: ZoneType };
  buildingAbandoned: { entity: number };
  buildingRecovered: { entity: number };
  zonesChanged: Record<string, never>;
};

export type CityState = {
  treasury: number;
  demand: DemandState;
  population: number;
};

export type CityWorld = World<CityEvents, CityCommands, CityComponents, CityState>;
