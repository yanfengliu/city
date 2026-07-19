import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury, rebuildDerived } from '../../src/sim/city';
import { GRID_WIDTH } from '../../src/sim/constants/map';
import { SERVICE_COST, SERVICE_RADIUS } from '../../src/sim/constants/services';
import { findLandBlock, findWaterAnchor } from './helpers';

/** Fields-enabled sim with a short road spine at base.y + 2. */
function townWithRoad() {
  const sim = createCitySim({ seed: 7, fieldsEnabled: true });
  const base = findLandBlock(sim, 12, 6);
  expect(
    sim.world.submit('placeRoad', {
      ax: base.x,
      ay: base.y + 2,
      bx: base.x + 8,
      by: base.y + 2,
    }),
  ).toBe(true);
  sim.world.step();
  return { sim, base };
}

describe('placeService', () => {
  it('places a service, debits treasury, and creates coverage inside the radius', () => {
    const { sim, base } = townWithRoad();
    const before = getTreasury(sim.world);
    expect(
      sim.world.submit('placeService', { service: 'fireStation', x: base.x, y: base.y }),
    ).toBe(true);
    sim.world.step();

    expect(getTreasury(sim.world)).toBe(before - SERVICE_COST.fireStation);
    expect([...sim.world.query('structure')]).toHaveLength(1);
    // 2x2 footprint claims occupancy (only the structure occupies cells here).
    expect(sim.occupiedCells.size).toBe(4);

    const coverage = sim.fields.coverage.fireStation;
    const radius = SERVICE_RADIUS.fireStation;
    expect(coverage.getAt(base.x, base.y)).toBe(1);
    expect(coverage.getAt(Math.min(GRID_WIDTH - 1, base.x + radius), base.y)).toBe(1);
    // Far beyond the radius (past any coverage-block slack) — pick the side with room.
    const farOffset = radius + 12;
    const farX = base.x + farOffset < GRID_WIDTH ? base.x + farOffset : base.x - farOffset;
    expect(coverage.getAt(farX, base.y)).toBe(0);

    // Score inputs see the coverage when fields are enabled.
    expect(sim.scoreInputs.coverageCount(base.x, base.y)).toBe(1);
  });

  it('rejects invalid placements', () => {
    const sim = createCitySim({ seed: 7, fieldsEnabled: true });
    const base = findLandBlock(sim, 12, 6);

    // No road anywhere yet.
    expect(sim.world.submit('placeService', { service: 'police', x: base.x, y: base.y })).toBe(
      false,
    );

    expect(
      sim.world.submit('placeRoad', {
        ax: base.x,
        ay: base.y + 2,
        bx: base.x + 8,
        by: base.y + 2,
      }),
    ).toBe(true);
    sim.world.step();

    // Water in the footprint.
    const water = findWaterAnchor(sim);
    expect(sim.world.submit('placeService', { service: 'police', x: water.x, y: water.y })).toBe(
      false,
    );

    // Footprint overlapping a road cell.
    expect(
      sim.world.submit('placeService', { service: 'police', x: base.x, y: base.y + 2 }),
    ).toBe(false);

    // Footprint overlapping an existing structure.
    expect(
      sim.world.submit('placeService', { service: 'fireStation', x: base.x, y: base.y }),
    ).toBe(true);
    sim.world.step();
    expect(
      sim.world.submit('placeService', { service: 'police', x: base.x + 1, y: base.y }),
    ).toBe(false);

    // Footprint out of bounds.
    expect(
      sim.world.submit('placeService', { service: 'police', x: GRID_WIDTH - 1, y: base.y }),
    ).toBe(false);

    // Insufficient funds (anchor itself is valid: free and road-adjacent).
    sim.world.runMaintenance(() => sim.world.setState('treasury', 5));
    expect(
      sim.world.submit('placeService', { service: 'police', x: base.x + 4, y: base.y }),
    ).toBe(false);
  });

  it('blocks roads and zoning on structure cells', () => {
    const { sim, base } = townWithRoad();
    expect(sim.world.submit('placeService', { service: 'clinic', x: base.x, y: base.y })).toBe(
      true,
    );
    sim.world.step();
    expect(
      sim.world.submit('placeRoad', { ax: base.x, ay: base.y, bx: base.x + 1, by: base.y }),
    ).toBe(false);
    expect(
      sim.world.submit('zone', {
        zone: 'R',
        ax: base.x,
        ay: base.y,
        bx: base.x + 1,
        by: base.y + 1,
      }),
    ).toBe(false);
  });

  it('bulldozeRect removes the structure, its occupancy, and its coverage', () => {
    const { sim, base } = townWithRoad();
    expect(sim.world.submit('placeService', { service: 'school', x: base.x, y: base.y })).toBe(
      true,
    );
    sim.world.step();
    expect(sim.scoreInputs.educated(base.x, base.y)).toBe(true);

    const treasuryBefore = getTreasury(sim.world);
    // A 1-cell rect clipping the footprint takes the whole structure down.
    expect(
      sim.world.submit('bulldozeRect', {
        ax: base.x + 1,
        ay: base.y + 1,
        bx: base.x + 1,
        by: base.y + 1,
      }),
    ).toBe(true);
    sim.world.step();

    expect([...sim.world.query('structure')]).toHaveLength(0);
    expect(sim.occupiedCells.size).toBe(0);
    expect(sim.fields.coverage.school.getAt(base.x, base.y)).toBe(0);
    expect(sim.scoreInputs.educated(base.x, base.y)).toBe(false);
    expect(getTreasury(sim.world)).toBe(treasuryBefore); // services refund nothing
  });

  it('restores structures, occupancy, and coverage after save/load', () => {
    const { sim, base } = townWithRoad();
    expect(sim.world.submit('placeService', { service: 'clinic', x: base.x, y: base.y })).toBe(
      true,
    );
    sim.world.step();
    for (let i = 0; i < 50; i++) sim.world.step();

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 7, fieldsEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    expect([...restored.world.query('structure')]).toHaveLength(1);
    expect(restored.occupiedCells.size).toBe(4);
    expect(restored.fields.coverage.clinic.getAt(base.x, base.y)).toBe(1);
    expect(restored.scoreInputs.coverageCount(base.x, base.y)).toBe(1);
  });
});
