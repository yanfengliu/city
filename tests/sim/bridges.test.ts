import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury, rebuildDerived } from '../../src/sim/city';
import { BUDGET_INTERVAL_TICKS } from '../../src/sim/constants/map';
import {
  BRIDGE_COST_PER_CELL,
  BRIDGE_UPKEEP_PER_CELL,
  ROAD_BULLDOZE_REFUND,
  ROAD_COST_PER_CELL,
  ROAD_UPKEEP_PER_CELL,
  STARTING_TREASURY,
} from '../../src/sim/constants/economy';
import { cellIndex } from '../../src/sim/grid';
import { findBridgeSite, findBridgeStub, stats } from './helpers';

/** 1 land cell + 2 water cells, straight out from the shore. */
function placeStubBridge(sim: ReturnType<typeof createCitySim>) {
  const stub = findBridgeStub(sim);
  const accepted = sim.world.submit('placeRoad', {
    ax: stub.x,
    ay: stub.y,
    bx: stub.x + 2 * stub.dx,
    by: stub.y + 2 * stub.dy,
  });
  expect(accepted).toBe(true);
  sim.world.step();
  return stub;
}

const STUB_COST = ROAD_COST_PER_CELL + 2 * BRIDGE_COST_PER_CELL;

describe('bridges', () => {
  it('places roads over water as bridges and charges the premium per cell', () => {
    const sim = createCitySim({ seed: 7 });
    placeStubBridge(sim);
    expect(sim.roadCells.size).toBe(3);
    expect(getTreasury(sim.world)).toBe(STARTING_TREASURY - STUB_COST);
    expect(sim.roadGraph.edges).toHaveLength(1);
  });

  it('refunds the bridge premium share on bulldoze', () => {
    const sim = createCitySim({ seed: 7 });
    const stub = placeStubBridge(sim);
    const before = getTreasury(sim.world);
    expect(
      sim.world.submit('bulldozeRoad', {
        ax: stub.x,
        ay: stub.y,
        bx: stub.x + 2 * stub.dx,
        by: stub.y + 2 * stub.dy,
      }),
    ).toBe(true);
    sim.world.step();
    expect(sim.roadCells.size).toBe(0);
    expect(getTreasury(sim.world)).toBe(before + Math.floor(STUB_COST * ROAD_BULLDOZE_REFUND));
  });

  it('charges bridge upkeep at the budget tick', () => {
    const sim = createCitySim({ seed: 7 });
    placeStubBridge(sim);
    const before = getTreasury(sim.world);
    while (sim.world.tick < BUDGET_INTERVAL_TICKS + 1) sim.world.step();
    expect(getTreasury(sim.world)).toBeCloseTo(
      before - (ROAD_UPKEEP_PER_CELL + 2 * BRIDGE_UPKEEP_PER_CELL),
      6,
    );
  });

  it('keeps bridge cells unzoneable (still water)', () => {
    const sim = createCitySim({ seed: 7 });
    const stub = placeStubBridge(sim);
    expect(
      sim.world.submit('zone', {
        zone: 'R',
        ax: stub.x + stub.dx,
        ay: stub.y + stub.dy,
        bx: stub.x + 2 * stub.dx,
        by: stub.y + 2 * stub.dy,
      }),
    ).toBe(false);
  });

  it('routes commuter traffic across a bridge', { timeout: 60_000 }, () => {
    const sim = createCitySim({ seed: 7 });
    const site = findBridgeSite(sim);
    expect(
      sim.world.submit('placeRoad', { ax: site.x0, ay: site.y, bx: site.x1, by: site.y }),
    ).toBe(true);
    sim.world.step();
    let bridgeCells = 0;
    for (let x = site.x0; x <= site.x1; x++) {
      if (sim.terrain.water[cellIndex(x, site.y)] === 1) bridgeCells++;
    }
    expect(bridgeCells).toBeGreaterThan(0);

    // Homes on the west shore only, jobs on the east shore only — every
    // commute must cross the water.
    expect(
      sim.world.submit('zone', {
        zone: 'R',
        ax: site.x0,
        ay: site.y - 2,
        bx: site.x0 + 5,
        by: site.y - 1,
      }),
    ).toBe(true);
    expect(
      sim.world.submit('zone', {
        zone: 'I',
        ax: site.x1 - 5,
        ay: site.y - 2,
        bx: site.x1,
        by: site.y - 1,
      }),
    ).toBe(true);
    sim.world.step();

    let maxVehicles = 0;
    for (let i = 0; i < 1400; i++) {
      sim.world.step();
      if (i % 4 === 0) maxVehicles = Math.max(maxVehicles, stats(sim).vehicles);
    }
    const s = stats(sim);
    expect(s.citizens).toBeGreaterThan(0);
    expect(s.employed).toBeGreaterThan(0);
    expect(maxVehicles).toBeGreaterThan(0);
    expect(s.disconnected).toBe(0);
  });

  it('rejects a bridge the treasury cannot cover (but allows a land road)', () => {
    const sim = createCitySim({ seed: 7 });
    const stub = findBridgeStub(sim);
    sim.world.runMaintenance(() => sim.world.setState('treasury', 39));
    expect(
      sim.world.submit('placeRoad', {
        ax: stub.x + stub.dx,
        ay: stub.y + stub.dy,
        bx: stub.x + stub.dx,
        by: stub.y + stub.dy,
      }),
    ).toBe(false);
    expect(
      sim.world.submit('placeRoad', { ax: stub.x, ay: stub.y, bx: stub.x, by: stub.y }),
    ).toBe(true);
  });

  it('never overdrafts when a same-tick bulldoze grows the placed path', () => {
    const sim = createCitySim({ seed: 7 });
    const stub = placeStubBridge(sim);
    // Treasury covers exactly the ONE new water cell the validator sees
    // (extending the stub by one). A same-tick bulldoze then frees the two
    // existing bridge cells, so the handler's recomputed path is three water
    // cells (cost 120) — the handler must no-op, never charge past the gate.
    sim.world.runMaintenance(() => sim.world.setState('treasury', BRIDGE_COST_PER_CELL));
    expect(
      sim.world.submit('bulldozeRoad', {
        ax: stub.x + stub.dx,
        ay: stub.y + stub.dy,
        bx: stub.x + 2 * stub.dx,
        by: stub.y + 2 * stub.dy,
      }),
    ).toBe(true);
    expect(
      sim.world.submit('placeRoad', {
        ax: stub.x,
        ay: stub.y,
        bx: stub.x + 3 * stub.dx,
        by: stub.y + 3 * stub.dy,
      }),
    ).toBe(true);
    sim.world.step();
    expect(getTreasury(sim.world)).toBeGreaterThanOrEqual(0);
    // The no-op leaves only the stub's land cell (the bulldoze kept it).
    expect(sim.roadCells.size).toBe(1);
  });

  it('bulldozeRect refunds bridge cells at the premium share', () => {
    const sim = createCitySim({ seed: 7 });
    const stub = placeStubBridge(sim);
    const before = getTreasury(sim.world);
    const x1 = stub.x + 2 * stub.dx;
    const y1 = stub.y + 2 * stub.dy;
    expect(
      sim.world.submit('bulldozeRect', {
        ax: Math.min(stub.x, x1),
        ay: Math.min(stub.y, y1),
        bx: Math.max(stub.x, x1),
        by: Math.max(stub.y, y1),
      }),
    ).toBe(true);
    sim.world.step();
    expect(sim.roadCells.size).toBe(0);
    expect(getTreasury(sim.world)).toBe(before + Math.floor(STUB_COST * ROAD_BULLDOZE_REFUND));
  });

  it('survives a snapshot round-trip (rebuildDerived keeps bridge edges)', () => {
    const sim = createCitySim({ seed: 7 });
    placeStubBridge(sim);
    const snapshot = sim.world.serialize();

    const restored = createCitySim({ seed: 7 });
    restored.world.applySnapshot(JSON.parse(JSON.stringify(snapshot)));
    rebuildDerived(restored);
    expect(restored.roadCells).toEqual(sim.roadCells);
    expect(restored.roadGraph.edges).toHaveLength(1);
    expect(getTreasury(restored.world)).toBe(getTreasury(sim.world));
  });
});
