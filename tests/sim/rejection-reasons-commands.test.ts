import { describe, expect, it } from 'vitest';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { GRID_HEIGHT, GRID_WIDTH } from '../../src/sim/constants/map';
import { HIGHWAY_COLUMN, HIGHWAY_LENGTH } from '../../src/sim/constants/highway';
import { MAX_TAX_RATE, MIN_TAX_RATE } from '../../src/sim/constants/economy';
import { ZONE_MAX_ROAD_DISTANCE } from '../../src/sim/constants/zoning';
import { cellIndex } from '../../src/sim/grid';
import { buildDistrict, expectRejection, findLandBlock, roadedSite } from './helpers';

/**
 * Companion to rejection-reasons.test.ts, covering the road, zoning, tax and
 * utility-network validators. Same contract: every assertion pins the offending
 * coordinate, value or limit the message must name, so a generic string cannot
 * pass.
 */

/** A land cell whose eastern neighbour is water — a shore to build across. */
function shoreCell(sim: CitySim): { x: number; y: number } {
  for (let y = 1; y < sim.terrain.height - 2; y++) {
    for (let x = 1; x < sim.terrain.width - 3; x++) {
      if (
        sim.terrain.water[cellIndex(x, y)] === 0 &&
        sim.terrain.water[cellIndex(x + 1, y)] === 1
      ) {
        return { x, y };
      }
    }
  }
  throw new Error('no land/water boundary found');
}

describe('road command rejection reasons', () => {
  it('names the off-map endpoint and the usable coordinate range', () => {
    const sim = createCitySim({ seed: 5 });
    const reason = expectRejection(sim, 'placeRoad', {
      ax: 0,
      ay: 0,
      bx: GRID_WIDTH,
      by: 0,
    });
    expect(reason).toContain(`(${GRID_WIDTH}, 0)`);
    expect(reason).toContain(`(${GRID_WIDTH - 1}, ${GRID_HEIGHT - 1})`);
  });

  it('says the whole path is already paved, and names the span', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    const reason = expectRejection(sim, 'placeRoad', {
      ax: base.x,
      ay: base.y,
      bx: base.x + 10,
      by: base.y,
    });
    expect(reason).toMatch(/already road/i);
    expect(reason).toContain(`(${base.x}, ${base.y})`);
    expect(reason).toContain(`(${base.x + 10}, ${base.y})`);
  });

  it('names the blocking cell and what occupies it', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    expect(
      sim.world.submit('placeService', { service: 'fireStation', x: base.x, y: base.y + 1 }),
    ).toBe(true);
    sim.world.step();

    const reason = expectRejection(sim, 'placeRoad', {
      ax: base.x,
      ay: base.y + 2,
      bx: base.x + 3,
      by: base.y + 2,
    });
    expect(reason).toContain(`(${base.x}, ${base.y + 2})`);
    expect(reason).toMatch(/fire station/i);
  });

  it('names the level and zone of a grown building in the way', () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 120; i++) sim.world.step();

    const grown = [...sim.world.query('building', 'position')].sort((a, b) => a - b)[0];
    expect(grown, 'district produced no buildings to block a road').toBeDefined();
    const at = sim.world.getComponent(grown, 'position');
    if (!at) throw new Error('grown building has no position');

    const reason = expectRejection(sim, 'placeRoad', {
      ax: at.x,
      ay: at.y,
      bx: at.x,
      by: at.y,
    });
    expect(reason).toContain(`(${at.x}, ${at.y})`);
    expect(reason).toMatch(/residential building/i);
  });

  it('names the cost and the treasury when a road is unaffordable', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    sim.world.runMaintenance(() => {
      sim.world.setState('treasury', 5);
    });
    const reason = expectRejection(sim, 'placeRoad', {
      ax: base.x,
      ay: base.y + 3,
      bx: base.x + 3,
      by: base.y + 3,
    });
    expect(reason).toMatch(/\$40\b/);
    expect(reason).toMatch(/\$5\b/);
  });

  it('says there is no road to bulldoze, and names the span', () => {
    const sim = createCitySim({ seed: 5 });
    const base = findLandBlock(sim, 6, 6);
    const reason = expectRejection(sim, 'bulldozeRoad', {
      ax: base.x,
      ay: base.y,
      bx: base.x + 4,
      by: base.y,
    });
    expect(reason).toContain(`(${base.x}, ${base.y})`);
    expect(reason).toContain(`(${base.x + 4}, ${base.y})`);
    expect(reason).toMatch(/nothing to bulldoze/i);
  });

  it('explains that the outside highway is permanent (bulldozeRoad)', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: true });
    const reason = expectRejection(sim, 'bulldozeRoad', {
      ax: HIGHWAY_COLUMN,
      ay: 0,
      bx: HIGHWAY_COLUMN,
      by: HIGHWAY_LENGTH - 1,
    });
    expect(reason).toMatch(/highway/i);
    expect(reason).toMatch(/permanent/i);
  });

  it('explains that the outside highway is permanent (bulldozeRect)', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: true });
    const reason = expectRejection(sim, 'bulldozeRect', {
      ax: HIGHWAY_COLUMN,
      ay: 0,
      bx: HIGHWAY_COLUMN,
      by: HIGHWAY_LENGTH - 1,
    });
    expect(reason).toMatch(/highway/i);
    expect(reason).toMatch(/permanent/i);
  });

  it('lists what an empty bulldoze area was searched for', () => {
    const sim = createCitySim({ seed: 5 });
    const base = findLandBlock(sim, 6, 6);
    const reason = expectRejection(sim, 'bulldozeRect', {
      ax: base.x,
      ay: base.y,
      bx: base.x + 2,
      by: base.y + 2,
    });
    expect(reason).toContain(`(${base.x}, ${base.y})`);
    expect(reason).toContain(`(${base.x + 2}, ${base.y + 2})`);
    expect(reason).toMatch(/road/i);
  });
});

describe('zoning command rejection reasons', () => {
  it('names the off-map corner of a zoning area', () => {
    const sim = createCitySim({ seed: 5 });
    const reason = expectRejection(sim, 'zone', {
      zone: 'R',
      ax: 0,
      ay: 0,
      bx: 0,
      by: GRID_HEIGHT,
    });
    expect(reason).toContain(`(0, ${GRID_HEIGHT})`);
    expect(reason).toContain(`(${GRID_WIDTH - 1}, ${GRID_HEIGHT - 1})`);
  });

  it('names the road-distance rule and the first cell that breaks it', () => {
    const sim = createCitySim({ seed: 5 });
    const base = findLandBlock(sim, 6, 6);
    const reason = expectRejection(sim, 'zone', {
      zone: 'R',
      ax: base.x,
      ay: base.y,
      bx: base.x + 3,
      by: base.y + 3,
    });
    expect(reason).toContain(`(${base.x}, ${base.y})`);
    expect(reason).toContain(`${ZONE_MAX_ROAD_DISTANCE} cells from a road`);
  });

  it('names the existing zone when repainting already-zoned land', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    const area = { ax: base.x, ay: base.y + 1, bx: base.x + 3, by: base.y + 1 };
    expect(sim.world.submit('zone', { zone: 'R', ...area })).toBe(true);
    sim.world.step();

    const reason = expectRejection(sim, 'zone', { zone: 'C', ...area });
    expect(reason).toContain(`(${base.x}, ${base.y + 1})`);
    expect(reason).toMatch(/already zoned R/);
  });

  it('says nothing in the area is zoned, and names the span', () => {
    const sim = createCitySim({ seed: 5 });
    const base = findLandBlock(sim, 6, 6);
    const reason = expectRejection(sim, 'dezone', {
      ax: base.x,
      ay: base.y,
      bx: base.x + 2,
      by: base.y + 2,
    });
    expect(reason).toContain(`(${base.x}, ${base.y})`);
    expect(reason).toContain(`(${base.x + 2}, ${base.y + 2})`);
    expect(reason).toMatch(/is zoned/i);
  });

  it('names the cell and occupant when every zoned cell is built on', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    const area = { ax: base.x, ay: base.y + 1, bx: base.x + 1, by: base.y + 2 };
    expect(sim.world.submit('zone', { zone: 'R', ...area })).toBe(true);
    sim.world.step();
    // A service occupies the 2x2 without clearing its zoning, so every zoned
    // cell in the area is built on.
    expect(
      sim.world.submit('placeService', { service: 'clinic', x: base.x, y: base.y + 1 }),
    ).toBe(true);
    sim.world.step();

    const reason = expectRejection(sim, 'dezone', area);
    expect(reason).toContain(`(${base.x}, ${base.y + 1})`);
    expect(reason).toMatch(/clinic/i);
  });
});

describe('tax rate rejection reasons', () => {
  it('names the out-of-range rate and the range that would work', () => {
    const sim = createCitySim({ seed: 5 });
    const reason = expectRejection(sim, 'setTaxRate', { zone: 'R', rate: 42 });
    expect(reason).toContain('42');
    expect(reason).toContain(`${MIN_TAX_RATE} to ${MAX_TAX_RATE}`);
  });

  it('names a fractional rate and asks for a whole percent', () => {
    const sim = createCitySim({ seed: 5 });
    const reason = expectRejection(sim, 'setTaxRate', { zone: 'C', rate: 7.5 });
    expect(reason).toContain('7.5');
    expect(reason).toMatch(/whole/i);
  });

  it('names the unknown zone and lists the real ones', () => {
    const sim = createCitySim({ seed: 5 });
    const reason = expectRejection(sim, 'setTaxRate', { zone: 'X', rate: 5 });
    expect(reason).toContain('X');
    expect(reason).toContain('R, C, or I');
  });
});

describe('utility network rejection reasons', () => {
  it('names the water cell a power line cannot cross', () => {
    const sim = createCitySim({ seed: 5 });
    const shore = shoreCell(sim);
    const reason = expectRejection(sim, 'placePowerLine', {
      ax: shore.x,
      ay: shore.y,
      bx: shore.x + 2,
      by: shore.y,
    });
    expect(reason).toContain(`(${shore.x + 1}, ${shore.y})`);
    expect(reason).toMatch(/water/i);
    expect(reason).toMatch(/power line/i);
  });

  it('says the span already carries a power line', () => {
    const sim = createCitySim({ seed: 5 });
    const base = findLandBlock(sim, 6, 6);
    const span = { ax: base.x, ay: base.y, bx: base.x + 3, by: base.y };
    expect(sim.world.submit('placePowerLine', span)).toBe(true);
    sim.world.step();

    const reason = expectRejection(sim, 'placePowerLine', span);
    expect(reason).toContain(`(${base.x}, ${base.y})`);
    expect(reason).toContain(`(${base.x + 3}, ${base.y})`);
    expect(reason).toMatch(/already carries a power line/i);
  });

  it('says the span already has a pipe', () => {
    const sim = createCitySim({ seed: 5 });
    const base = findLandBlock(sim, 6, 6);
    const span = { ax: base.x, ay: base.y, bx: base.x + 3, by: base.y };
    expect(sim.world.submit('placePipe', span)).toBe(true);
    sim.world.step();

    const reason = expectRejection(sim, 'placePipe', span);
    expect(reason).toContain(`(${base.x}, ${base.y})`);
    expect(reason).toMatch(/already has a pipe/i);
  });

  it('names the off-map endpoint of a power line', () => {
    const sim = createCitySim({ seed: 5 });
    const reason = expectRejection(sim, 'placePowerLine', {
      ax: -1,
      ay: 0,
      bx: 4,
      by: 0,
    });
    expect(reason).toContain('(-1, 0)');
    expect(reason).toMatch(/power line/i);
  });

  it('names the off-map endpoint of a pipe', () => {
    const sim = createCitySim({ seed: 5 });
    const reason = expectRejection(sim, 'placePipe', {
      ax: 0,
      ay: 0,
      bx: 4,
      by: GRID_HEIGHT,
    });
    expect(reason).toContain(`(4, ${GRID_HEIGHT})`);
    expect(reason).toMatch(/pipe/i);
  });
});
