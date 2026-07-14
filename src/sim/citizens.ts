import { MOVE_IN_BASE, MOVE_IN_DEMAND_SCALE, MOVE_IN_TRICKLE_THRESHOLD } from './constants/zoning';
import { buildingCapacity } from './buildings';
import type { CitySim } from './city';
import type { CityWorld, DemandState } from './types';

/**
 * Moves new citizens (households) into residential buildings while R demand is
 * positive. All counts are in citizen entities — the canonical sim unit.
 */
export function moveInSystem(_sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const demand = w.getState('demand') as DemandState | undefined;
    // Below the trickle threshold nobody comes; between it and 0, cheap empty
    // housing attracts a slow trickle — prevents post-crash ghost towns where
    // vacancy suppresses demand and nobody ever returns (playtest round 1).
    if (!demand || demand.r <= MOVE_IN_TRICKLE_THRESHOLD) return;

    // Non-abandoned residential buildings with free capacity, canonical order.
    const open: Array<{ id: number; free: number }> = [];
    let freeHousingCapacity = 0;
    for (const id of [...w.query('building')].sort((a, b) => a - b)) {
      const building = w.getComponent(id, 'building');
      if (!building || building.zone !== 'R' || building.abandoned) continue;
      const free = buildingCapacity(building) - building.residents;
      if (free > 0) {
        open.push({ id, free });
        freeHousingCapacity += free;
      }
    }
    if (open.length === 0) return;

    const arrivals = Math.min(
      freeHousingCapacity,
      demand.r > 0 ? MOVE_IN_BASE + Math.floor(demand.r * MOVE_IN_DEMAND_SCALE) : 1,
    );
    for (let n = 0; n < arrivals; n++) {
      const pick = open[Math.floor(w.random() * open.length)];
      if (pick.free <= 0) continue; // attempt consumed, deterministic
      const home = pick.id;
      const position = w.getComponent(home, 'position');
      if (!position) continue;
      const citizen = w.createEntity();
      w.setPosition(citizen, { x: position.x, y: position.y });
      w.addComponent(citizen, 'citizen', {
        home,
        work: null,
        phase: 'home',
        waitUntil: 0,
        nextActivity: 'work',
        shop: null,
        shopGen: null,
      });
      w.patchComponent(home, 'building', (b) => {
        b.residents += 1;
      });
      pick.free -= 1;
    }
  };
}
