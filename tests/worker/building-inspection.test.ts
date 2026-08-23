import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { inspectBuildingResponse } from '../../src/worker/building-inspection';
import { seedBuilding, seedCitizen } from '../sim/helpers';

/**
 * The worker seam. Every failure path must name the entity and what is wrong
 * with it: a click that lands on a demolished block is normal play, and a bare
 * null would surface as an empty panel with nothing to act on.
 */

function city() {
  return createCitySim({ seed: 5, fieldsEnabled: true, utilitiesEnabled: true });
}

function request(entity: number, generation: number) {
  return { type: 'inspectBuilding' as const, id: 9, entity, generation };
}

describe('inspectBuildingResponse', () => {
  it('answers a live building with its detail and echoes the correlating id', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 5, y: 5, zone: 'R', residents: 2 });
    const generation = sim.world.getEntityGeneration(home);

    const reply = inspectBuildingResponse(sim, request(home, generation));

    expect(reply.id).toBe(9);
    expect(reply.entity).toBe(home);
    expect(reply.generation).toBe(generation);
    expect(reply.detail?.kind).toBe('growable');
    expect(reply.error).toBeUndefined();
  });

  it('refuses a stale generation and names the current one', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 5, y: 5, zone: 'R', residents: 2 });
    const generation = sim.world.getEntityGeneration(home);

    const reply = inspectBuildingResponse(sim, request(home, generation + 1));

    expect(reply.detail).toBeNull();
    expect(reply.error).toContain(`its current generation is ${generation}`);
  });

  it('refuses a demolished building by saying it is gone', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 5, y: 5, zone: 'R', residents: 2 });
    const generation = sim.world.getEntityGeneration(home);
    sim.world.runMaintenance(() => sim.world.destroyEntity(home));

    const reply = inspectBuildingResponse(sim, request(home, generation));

    expect(reply.detail).toBeNull();
    expect(reply.error).toMatch(/no longer alive/);
  });

  it('redirects a household query to the person panel instead of failing blankly', () => {
    const sim = city();
    const home = seedBuilding(sim, { x: 5, y: 5, zone: 'R', residents: 1 });
    const household = seedCitizen(sim, home, null);

    const reply = inspectBuildingResponse(
      sim,
      request(household, sim.world.getEntityGeneration(household)),
    );

    expect(reply.detail).toBeNull();
    expect(reply.error).toMatch(/inspect it as a person instead/);
  });

  it('rejects a malformed identity rather than reading a random entity slot', () => {
    const sim = city();

    expect(inspectBuildingResponse(sim, request(-1, 0)).error).toMatch(/not an entity id/);
    expect(inspectBuildingResponse(sim, request(3, -2)).error).toMatch(/generation -2 is invalid/);
  });
});
