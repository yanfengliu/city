import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { findLandBlock } from './helpers';

describe('road/line crossings are symmetric', () => {
  it('a road can be placed across an existing power line and both keep working', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    const w = sim.world;
    // Vertical power line first, then a horizontal road across it.
    expect(
      w.submit('placePowerLine', { ax: base.x + 5, ay: base.y, bx: base.x + 5, by: base.y + 8 }),
    ).toBe(true);
    w.step();
    expect(
      w.submit('placeRoad', { ax: base.x, ay: base.y + 4, bx: base.x + 10, by: base.y + 4 }),
    ).toBe(true);
    w.step();
    const crossing = (base.y + 4) * 128 + (base.x + 5);
    expect(sim.roadCells.has(crossing)).toBe(true);
    expect(sim.powerLineCells.has(crossing)).toBe(true);
    // The crossing cell is road-owned, not blocked for future roads.
    expect(sim.occupiedCells.has(crossing)).toBe(false);

    // Bulldozing the road leaves the line intact; the cell stays free (a line
    // is a thin overlay that never owns occupiedCells).
    expect(
      w.submit('bulldozeRoad', { ax: base.x + 5, ay: base.y + 4, bx: base.x + 5, by: base.y + 4 }),
    ).toBe(true);
    w.step();
    expect(sim.roadCells.has(crossing)).toBe(false);
    expect(sim.powerLineCells.has(crossing)).toBe(true);
    expect(sim.occupiedCells.has(crossing)).toBe(false);
  });
});

describe('move-in trickle', () => {
  it('citizens trickle into vacant homes while demand is mildly negative', () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 18);
    const w = sim.world;
    w.submit('placeRoad', { ax: base.x, ay: base.y + 2, bx: base.x + 15, by: base.y + 2 });
    w.step();
    w.submit('zone', { zone: 'R', ax: base.x, ay: base.y, bx: base.x + 15, by: base.y + 4 });
    w.step();
    // Pure-R town: capacity overshoots, R demand goes <= 0, but the trickle
    // keeps arrivals coming while demand stays above the trickle threshold.
    let sawNegativeDemandGrowth = false;
    let lastCitizens = 0;
    for (let i = 0; i < 1600; i++) {
      w.step();
      if (i % 64 === 0) {
        const demand = w.getState('demand') as { r: number };
        const citizens = [...w.query('citizen')].length;
        if (demand.r <= 0 && demand.r > -0.3 && citizens > lastCitizens) {
          sawNegativeDemandGrowth = true;
        }
        lastCitizens = citizens;
      }
    }
    expect([...w.query('citizen')].length).toBeGreaterThan(10);
    expect(sawNegativeDemandGrowth).toBe(true);
  });
});

describe('bulldoze rubble', () => {
  it('bulldozed building cells do not regrow before the player can build a road', () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 18);
    const w = sim.world;
    w.submit('placeRoad', { ax: base.x, ay: base.y + 2, bx: base.x + 15, by: base.y + 2 });
    w.step();
    w.submit('zone', { zone: 'R', ax: base.x, ay: base.y, bx: base.x + 15, by: base.y + 4 });
    w.step();
    // Grow a dense band.
    for (let i = 0; i < 400; i++) w.step();

    // Player clears a connector column...
    const colX = base.x + 8;
    expect(
      w.submit('bulldozeRect', { ax: colX, ay: base.y + 3, bx: colX + 1, by: base.y + 4 }),
    ).toBe(true);
    w.step();
    // ...dawdles a few growth cycles (the old race window)...
    for (let i = 0; i < 40; i++) w.step();
    // ...and the road still fits.
    expect(
      w.submit('placeRoad', { ax: colX, ay: base.y + 2, bx: colX, by: base.y + 4 }),
    ).toBe(true);
    w.step();
    expect(sim.roadCells.has((base.y + 4) * 128 + colX)).toBe(true);
  });
});
