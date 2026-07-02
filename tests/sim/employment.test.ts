import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { buildDistrict, findLandBlock, stats } from './helpers';

/**
 * Employment is route-based: citizens only take jobs whose access node shares
 * a road-graph component with their home's access node — no phantom commutes
 * to workplaces they can never reach.
 */
describe('route-based employment', () => {
  it('skips unreachable jobs and assigns them once connected', { timeout: 60_000 }, () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 18);
    // Two parallel road spines 10 rows apart with NO connection: the I jobs
    // are close by distance but in a different graph component.
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 10 });
    // Keep the future connector column clear of growth (dezone it) so the
    // phase-2 road can land after buildings have grown everywhere else.
    const midX = base.x + 8;
    expect(
      sim.world.submit('dezone', { ax: midX, ay: base.y, bx: midX, by: base.y + 14 }),
    ).toBe(true);
    for (let i = 0; i < 600; i++) sim.world.step();
    const before = stats(sim);
    expect(before.citizens).toBeGreaterThan(0);
    expect(before.employed).toBe(0);
    expect(before.disconnected).toBe(0);

    // Connect the spines; employment (and commuting) should now happen.
    expect(
      sim.world.submit('placeRoad', { ax: midX, ay: base.y + 2, bx: midX, by: base.y + 12 }),
    ).toBe(true);
    for (let i = 0; i < 600; i++) sim.world.step();
    const after = stats(sim);
    expect(after.employed).toBeGreaterThan(0);
    expect(after.disconnected).toBe(0);
  });
});
