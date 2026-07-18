import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import { expectRejection as reject, roadedSite } from './helpers';

/**
 * A rejected command must say which input failed which rule (AGENTS.md: error
 * messages are a product surface). These contracts pin the *content* of the
 * reason, not just its presence — a generic string would pass a mere
 * "is non-empty" assertion and teach the player nothing.
 *
 * rejection-reasons-commands.test.ts carries the same contracts for the road,
 * zoning, tax and utility-network validators.
 */

describe('placement rejection reasons', () => {
  /**
   * Regression for the defect that motivated this contract: five browser
   * placements of "policeStation" (the type is `police`) were refused with
   * only "Validation failed", so the wrong-name cause stayed invisible.
   */
  it('names the bad service and lists the valid ones', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    const reason = reject(sim, 'placeService', {
      service: 'policeStation',
      x: base.x,
      y: base.y + 1,
    });
    expect(reason).toContain('policeStation');
    expect(reason).toContain('police');
    expect(reason).toContain('clinic');
  });

  it('names the road requirement when nothing touches a road', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    // Four rows below the road: far enough that no footprint cell is adjacent.
    const reason = reject(sim, 'placeService', {
      service: 'police',
      x: base.x,
      y: base.y + 4,
    });
    expect(reason).toMatch(/road/i);
  });

  it('names the occupying structure and its cell', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    expect(
      sim.world.submit('placeService', {
        service: 'fireStation',
        x: base.x,
        y: base.y + 1,
      }),
    ).toBe(true);
    sim.world.step();

    // Same spot again: now occupied by the fire station.
    const reason = reject(sim, 'placeService', {
      service: 'police',
      x: base.x,
      y: base.y + 1,
    });
    expect(reason).toMatch(/occupied|fire station/i);
    expect(reason).toContain(`${base.x}`);
  });

  it('names water as the blocker and points at the wet cell', () => {
    const sim = createCitySim({ seed: 5 });
    // Find a land cell whose right neighbour is water, then straddle them.
    let spot: { x: number; y: number } | null = null;
    for (let y = 1; y < sim.terrain.height - 2 && !spot; y++) {
      for (let x = 1; x < sim.terrain.width - 2; x++) {
        if (
          sim.terrain.water[cellIndex(x, y)] === 0 &&
          sim.terrain.water[cellIndex(x + 1, y)] === 1
        ) {
          spot = { x, y };
          break;
        }
      }
    }
    if (!spot) throw new Error('no land/water boundary found');

    const reason = reject(sim, 'placeService', {
      service: 'clinic',
      x: spot.x,
      y: spot.y,
    });
    expect(reason).toMatch(/water/i);
    expect(reason).toContain(`${spot.x + 1}`);
  });

  it('names the cost and the shortfall when funds are too low', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    sim.world.runMaintenance(() => {
      sim.world.setState('treasury', 10);
    });
    const reason = reject(sim, 'placeService', {
      service: 'school',
      x: base.x,
      y: base.y + 1,
    });
    expect(reason).toMatch(/\$500/);
    expect(reason).toMatch(/\$10\b/);
  });

  it('leaves no stale reason behind an accepted command', () => {
    const sim = createCitySim({ seed: 5 });
    const base = roadedSite(sim);
    reject(sim, 'placeService', { service: 'clinic', x: base.x, y: base.y + 4 });
    expect(sim.lastRejection).not.toBeNull();

    expect(
      sim.world.submit('placeService', {
        service: 'clinic',
        x: base.x,
        y: base.y + 1,
      }),
    ).toBe(true);
    expect(sim.lastRejection).toBeNull();
  });
});
