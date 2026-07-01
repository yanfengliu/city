import { World } from 'civ-engine';
import { GRID_HEIGHT, GRID_WIDTH, TPS } from './constants/map';

export interface CityWorldConfig {
  seed: number;
}

/**
 * Builds the city World. Registration order below is a replay/save contract:
 * append new registrations at the end of their section, never reorder.
 */
export function createCityWorld(config: CityWorldConfig): World {
  const world = new World({
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    tps: TPS,
    seed: config.seed,
  });

  // -- components (phase 1+) --
  // -- world state / map generation (phase 1+) --
  // -- commands (phase 1+) --
  // -- systems (phase 1+) --

  world.endSetup();
  return world;
}
