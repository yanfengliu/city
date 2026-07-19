import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import {
  inspectCitizenResponse,
  inspectHomeResidentResponse,
} from '../../src/worker/citizen-inspection';
import { seedBuilding, seedCitizen } from '../sim/helpers';

function residentHome(count = 3) {
  const sim = createCitySim({ seed: 71 });
  const home = seedBuilding(sim, { x: 12, y: 18, zone: 'R', residents: count });
  const residents = Array.from({ length: count }, () => seedCitizen(sim, home, null));
  return { sim, home, residents };
}

describe('generation-guarded citizen inspection', () => {
  it('returns detail only for the requested household incarnation', () => {
    const { sim, residents } = residentHome(1);
    const entity = residents[0];
    const generation = sim.world.getEntityGeneration(entity);

    expect(
      inspectCitizenResponse(sim, {
        type: 'inspectCitizen',
        id: 4,
        entity,
        generation,
        memberId: 1,
      }),
    ).toMatchObject({
      id: 4,
      entity,
      generation,
      detail: { entity, generation, selectedMemberId: 1 },
    });

    const stale = inspectCitizenResponse(sim, {
      type: 'inspectCitizen',
      id: 5,
      entity,
      generation: generation + 1,
      memberId: 1,
    });
    expect(stale.detail).toBeNull();
    expect(stale.error).toMatch(/stale.*current generation/i);
  });
});

describe('residential building person drill-down', () => {
  it('cycles each household member in canonical order without streaming resident ids', () => {
    const { sim, home, residents } = residentHome(3);
    const buildingGeneration = sim.world.getEntityGeneration(home);
    const first = inspectHomeResidentResponse(sim, {
      type: 'inspectHomeResident',
      id: 10,
      building: home,
      buildingGeneration,
    });
    expect(first).toMatchObject({
      entity: residents[0],
      residentContext: {
        building: { id: home, generation: buildingGeneration },
        index: 0,
        total: 9,
      },
      detail: { selectedMemberId: 0 },
    });

    const second = inspectHomeResidentResponse(sim, {
      type: 'inspectHomeResident',
      id: 11,
      building: home,
      buildingGeneration,
      afterCitizen: residents[0],
      afterCitizenGeneration: sim.world.getEntityGeneration(residents[0]),
      afterMemberId: 0,
    });
    expect(second.entity).toBe(residents[0]);
    expect(second.detail?.selectedMemberId).toBe(1);
    expect(second.residentContext?.index).toBe(1);

    const nextHousehold = inspectHomeResidentResponse(sim, {
      type: 'inspectHomeResident',
      id: 12,
      building: home,
      buildingGeneration,
      afterCitizen: residents[0],
      afterCitizenGeneration: sim.world.getEntityGeneration(residents[0]),
      afterMemberId: 2,
    });
    expect(nextHousehold.entity).toBe(residents[1]);
    expect(nextHousehold.detail?.selectedMemberId).toBe(0);
    expect(nextHousehold.residentContext?.index).toBe(3);

    const wrapped = inspectHomeResidentResponse(sim, {
      type: 'inspectHomeResident',
      id: 13,
      building: home,
      buildingGeneration,
      afterCitizen: residents[2],
      afterCitizenGeneration: sim.world.getEntityGeneration(residents[2]),
      afterMemberId: 2,
    });
    expect(wrapped.entity).toBe(residents[0]);
    expect(wrapped.residentContext?.index).toBe(0);
  });

  it('does not treat a recycled citizen id as the prior resident cursor', () => {
    const { sim, home, residents } = residentHome(2);
    const buildingGeneration = sim.world.getEntityGeneration(home);
    const oldGeneration = sim.world.getEntityGeneration(residents[0]);
    sim.world.runMaintenance(() => sim.world.destroyEntity(residents[0]));
    let replacement = -1;
    sim.world.runMaintenance(() => {
      replacement = sim.world.createEntity();
      const homePosition = sim.world.getComponent(home, 'position');
      if (!homePosition) throw new Error(`home ${home} has no position`);
      sim.world.setPosition(replacement, { ...homePosition });
      sim.world.addComponent(replacement, 'citizen', {
        home,
        work: null,
        phase: 'home',
        waitUntil: 0,
        nextActivity: 'work',
        shop: null,
        shopGen: null,
      });
    });
    expect(replacement).toBe(residents[0]);
    expect(sim.world.getEntityGeneration(replacement)).not.toBe(oldGeneration);

    const response = inspectHomeResidentResponse(sim, {
      type: 'inspectHomeResident',
      id: 14,
      building: home,
      buildingGeneration,
      afterCitizen: replacement,
      afterCitizenGeneration: oldGeneration,
      afterMemberId: 0,
    });

    expect(response.entity).toBe(replacement);
    expect(response.generation).toBe(sim.world.getEntityGeneration(replacement));
    expect(response.detail?.selectedMemberId).toBe(0);
    expect(response.residentContext?.index).toBe(0);
  });

  it('explains empty, non-residential, and stale building inputs', () => {
    const { sim, home } = residentHome(0);
    const generation = sim.world.getEntityGeneration(home);
    expect(
      inspectHomeResidentResponse(sim, {
        type: 'inspectHomeResident',
        id: 20,
        building: home,
        buildingGeneration: generation,
      }).error,
    ).toMatch(/no households.*tick/i);

    const shop = seedBuilding(sim, { x: 20, y: 18, zone: 'C' });
    expect(
      inspectHomeResidentResponse(sim, {
        type: 'inspectHomeResident',
        id: 21,
        building: shop,
        buildingGeneration: sim.world.getEntityGeneration(shop),
      }).error,
    ).toMatch(/not residential/i);

    expect(
      inspectHomeResidentResponse(sim, {
        type: 'inspectHomeResident',
        id: 22,
        building: home,
        buildingGeneration: generation + 1,
      }).error,
    ).toMatch(/stale/i);
  });
});
