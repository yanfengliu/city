import { describe, expect, it } from 'vitest';
import { footprintCells } from '../../src/sim/buildings';
import { createCitySim, getTreasury, rebuildDerived, type CitySim } from '../../src/sim/city';
import { BUDGET_INTERVAL_TICKS, GRID_WIDTH } from '../../src/sim/constants/map';
import {
  COVERAGE_BLOCK_SIZE,
  SERVICE_COST,
  SERVICE_RADIUS,
  SERVICE_UPKEEP,
} from '../../src/sim/constants/services';
import { computeHappiness } from '../../src/sim/happiness';
import type { ServiceType } from '../../src/sim/types';
import { parkTown } from './park-town';
import { expectRejection, findWaterAnchor, stepUntil } from './helpers';

describe('community gardens as a service', () => {
  it('is cheap local green infrastructure rather than a smaller better park', () => {
    expect(SERVICE_COST.garden).toBe(90);
    expect(SERVICE_UPKEEP.garden).toBe(2);
    expect(SERVICE_RADIUS.garden).toBe(6);
    expect(SERVICE_COST.garden).toBeLessThan(SERVICE_COST.park);
    expect(SERVICE_RADIUS.garden).toBeLessThan(SERVICE_RADIUS.park);
    // Nominal covered area per dollar stays below a park, so gardens fill a
    // local gap instead of replacing the larger amenity everywhere.
    expect((2 * SERVICE_RADIUS.garden + 1) ** 2 / SERVICE_COST.garden).toBeLessThan(
      (2 * SERVICE_RADIUS.park + 1) ** 2 / SERVICE_COST.park,
    );
  });

  it('places a garden, debits its cost, and publishes only garden coverage', () => {
    const { sim, base, streetY } = parkTown();
    const anchor = { x: base.x + 2, y: streetY - 2 };
    const before = getTreasury(sim.world);
    expect(sim.world.submit('placeService', { service: 'garden', ...anchor })).toBe(true);
    sim.world.step();

    expect(getTreasury(sim.world)).toBe(before - SERVICE_COST.garden);
    expect(sim.fields.coverage.garden.getAt(anchor.x, anchor.y)).toBe(1);
    expect(sim.fields.coverage.garden.getAt(anchor.x + SERVICE_RADIUS.garden, anchor.y)).toBe(1);
    expect(
      sim.fields.coverage.garden.getAt(
        anchor.x + SERVICE_RADIUS.garden + COVERAGE_BLOCK_SIZE,
        anchor.y,
      ),
    ).toBe(0);
    expect(sim.fields.coverage.park.getAt(anchor.x, anchor.y)).toBe(0);
  });

  it('refuses invalid garden sites with garden-specific reasons', () => {
    const { sim, base, streetY } = parkTown();
    expect(
      expectRejection(sim, 'placeService', { service: 'garden', ...findWaterAnchor(sim) }),
    ).toContain('water');
    expect(
      expectRejection(sim, 'placeService', { service: 'garden', x: base.x, y: streetY }),
    ).toContain('is a road');
    expect(
      expectRejection(sim, 'placeService', {
        service: 'garden',
        x: GRID_WIDTH - 1,
        y: streetY - 2,
      }),
    ).toContain('outside');

    sim.world.runMaintenance(() => sim.world.setState('treasury', SERVICE_COST.garden - 1));
    const broke = expectRejection(sim, 'placeService', {
      service: 'garden',
      x: base.x + 2,
      y: streetY - 2,
    });
    expect(broke).toContain('a community garden');
    expect(broke).toContain(String(SERVICE_COST.garden));
  });

  it('counts overlapping parks and gardens as one green-space benefit', () => {
    const { sim, base, streetY, citizen } = parkTown();
    const home = { x: base.x + 1, y: streetY + 1 };
    sim.terrain.trees.fill(0);
    for (let n = 0; n < 40; n++) sim.world.step();
    const baseline = sim.scoreInputs.coverageCount(home.x, home.y);

    expect(
      sim.world.submit('placeService', { service: 'park', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    for (let n = 0; n < 40; n++) sim.world.step();
    const withPark = happinessFactor(sim, citizen);
    expect(sim.scoreInputs.coverageCount(home.x, home.y)).toBe(baseline + 1);
    const parkOnly = createCitySim({ seed: 7, fieldsEnabled: true });
    parkOnly.world.applySnapshot(JSON.parse(JSON.stringify(sim.world.serialize())));
    rebuildDerived(parkOnly);
    parkOnly.terrain.trees.fill(0);

    expect(
      sim.world.submit('placeService', { service: 'garden', x: base.x + 5, y: streetY - 2 }),
    ).toBe(true);
    for (let n = 0; n < 40; n++) {
      sim.world.step();
      parkOnly.world.step();
    }

    expect(sim.fields.coverage.park.getAt(home.x, home.y)).toBe(1);
    expect(sim.fields.coverage.garden.getAt(home.x, home.y)).toBe(1);
    expect(sim.scoreInputs.coverageCount(home.x, home.y)).toBe(baseline + 1);
    expect(happinessFactor(sim, citizen)).toBe(withPark);
    expect(sim.fields.landValue.getAt(home.x, home.y)).toBe(
      parkOnly.fields.landValue.getAt(home.x, home.y),
    );
    expect(serviceLabel(sim, citizen)).toContain('green space');
    expect(serviceLabel(sim, citizen)).toContain('1 of 5');
  });

  it('charges garden upkeep every budget interval', () => {
    const { sim, base, streetY } = parkTown();
    let expenses = 0;
    sim.world.on('budget', (report) => {
      expenses = report.expenses;
    });
    stepUntil(sim, () => expenses > 0, BUDGET_INTERVAL_TICKS + 2);
    const withoutGarden = expenses;

    expect(
      sim.world.submit('placeService', { service: 'garden', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();
    const seen = expenses;
    stepUntil(sim, () => expenses !== seen, BUDGET_INTERVAL_TICKS + 2);
    expect(expenses).toBe(withoutGarden + SERVICE_UPKEEP.garden);
  });

  it('clears wild trees for cultivated beds, exactly as a park and a clinic do', () => {
    const valueOnWoodedGround = (service: ServiceType): number => {
      const { sim, base, streetY } = parkTown();
      const anchor = { x: base.x + 2, y: streetY - 2 };
      sim.terrain.trees.fill(0);
      for (const cell of footprintCells(anchor.x, anchor.y, 2, 2)) sim.terrain.trees[cell] = 1;
      expect(sim.world.submit('placeService', { service, ...anchor })).toBe(true);
      for (let n = 0; n < 40; n++) sim.world.step();
      return sim.fields.landValue.getAt(anchor.x, anchor.y);
    };

    // Every special building — a garden, a park, a clinic — bulldozes the trees
    // on its footprint, so none keeps a tree bonus the others do not.
    expect(valueOnWoodedGround('garden')).toBe(valueOnWoodedGround('clinic'));
    expect(valueOnWoodedGround('park')).toBe(valueOnWoodedGround('clinic'));
  });

  it('loads an older coverage mirror with no garden key', () => {
    const { sim, base, streetY } = parkTown();
    expect(
      sim.world.submit('placeService', { service: 'park', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();
    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const mirrors = (
      snapshot.components as Record<string, Array<[number, Record<string, unknown>]>>
    ).coverageMirror;
    expect(mirrors).toHaveLength(1);
    for (const [, state] of mirrors) delete state.garden;

    const restored = createCitySim({ seed: 7, fieldsEnabled: true });
    restored.world.applySnapshot(snapshot);
    expect(() => rebuildDerived(restored)).not.toThrow();
    expect(restored.fields.coverage.park.getAt(base.x + 2, streetY - 2)).toBe(1);
    expect(restored.fields.coverage.garden.getAt(base.x + 2, streetY - 2)).toBe(0);
    expect(
      restored.world.submit('placeService', {
        service: 'garden',
        x: base.x + 5,
        y: streetY - 2,
      }),
    ).toBe(true);
    restored.world.step();
    expect(restored.fields.coverage.garden.getAt(base.x + 5, streetY - 2)).toBe(1);
  });

  it('preserves a garden and its occupancy across save and load', () => {
    const seed = 31;
    const town = parkTown({ seed, gardenOffsets: [2], activity: 'leisure' });
    for (let n = 0; n < 800; n++) town.sim.world.step();
    const snapshot = JSON.parse(JSON.stringify(town.sim.world.serialize()));

    const restored = createCitySim({ seed, fieldsEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);
    const gardens = [...restored.world.query('structure')].filter(
      (id) => restored.world.getComponent(id, 'structure')?.type === 'garden',
    );
    expect(gardens).toEqual(town.gardens);
    expect(restored.fields.coverage.garden.getAt(town.base.x + 2, town.streetY - 2)).toBe(1);
    expect(
      restored.occupiedCells.get(
        restored.terrain.width * (town.streetY - 2) + town.base.x + 2,
      ),
    ).toBe(gardens[0]);

    for (let n = 0; n < 800; n++) {
      town.sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(
      JSON.stringify(town.sim.world.serialize()),
    );
  });
});

function serviceFactor(sim: CitySim, citizen: number) {
  const factor = computeHappiness(sim, citizen)?.factors.find((entry) => entry.id === 'services');
  if (!factor) throw new Error(`citizen ${citizen} has no services happiness factor`);
  return factor;
}

function happinessFactor(sim: CitySim, citizen: number): number {
  return serviceFactor(sim, citizen).delta;
}

function serviceLabel(sim: CitySim, citizen: number): string {
  return serviceFactor(sim, citizen).label;
}
