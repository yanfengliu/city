import { describe, expect, it } from 'vitest';
import { footprintCells } from '../../src/sim/buildings';
import { createCitySim, getTreasury, rebuildDerived, type CitySim } from '../../src/sim/city';
import { BUDGET_INTERVAL_TICKS, GRID_WIDTH } from '../../src/sim/constants/map';
import {
  COVERAGE_BLOCK_SIZE,
  SERVICE_COST,
  SERVICE_RADIUS,
  SERVICE_TYPES,
  SERVICE_UPKEEP,
} from '../../src/sim/constants/services';
import { computeHappiness } from '../../src/sim/happiness';
import { NEAR_PARK, parkTown } from './park-town';
import { expectRejection, findWaterAnchor, stepUntil } from './helpers';

describe('parks as a service', () => {
  it('keeps park before the appended garden in the canonical service order', () => {
    // The WHOLE array is the determinism contract, not just park's position:
    // reordering any of it shifts every seeded outcome and recorded session.
    expect(SERVICE_TYPES).toEqual([
      'fireStation',
      'police',
      'clinic',
      'school',
      'park',
      'garden',
    ]);
  });

  it('prices a park as a neighbourhood amenity, not a civic institution', () => {
    expect(SERVICE_COST.park).toBeLessThan(SERVICE_COST.fireStation);
    expect(SERVICE_COST.park).toBeLessThan(SERVICE_COST.clinic);
    expect(SERVICE_UPKEEP.park).toBeLessThan(SERVICE_UPKEEP.fireStation);
    expect(SERVICE_RADIUS.park).toBeLessThan(SERVICE_RADIUS.fireStation);
    expect(SERVICE_RADIUS.park).toBeLessThan(SERVICE_RADIUS.school);
  });

  it('places a park, debits its cost, and covers only its own radius', () => {
    const { sim, base, streetY } = parkTown();
    const before = getTreasury(sim.world);
    expect(
      sim.world.submit('placeService', { service: 'park', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();

    expect(getTreasury(sim.world)).toBe(before - SERVICE_COST.park);
    const coverage = sim.fields.coverage.park;
    const anchorX = base.x + 2;
    expect(coverage.getAt(anchorX, streetY - 2)).toBe(1);
    // Pinned tight on BOTH sides so the radius cannot drift unnoticed: covered
    // out to the radius edge, and clear one coverage block past it (a block is
    // COVERAGE_BLOCK_SIZE wide, which is the whole slack the metric allows).
    expect(coverage.getAt(anchorX + SERVICE_RADIUS.park, streetY - 2)).toBe(1);
    expect(
      coverage.getAt(anchorX + SERVICE_RADIUS.park + COVERAGE_BLOCK_SIZE, streetY - 2),
    ).toBe(0);
    // A park does not light any other service's layer.
    expect(sim.fields.coverage.clinic.getAt(anchorX, streetY - 2)).toBe(0);
  });

  it('refuses a park wherever a service would be refused, and says why', () => {
    const { sim, base, streetY } = parkTown();
    const water = findWaterAnchor(sim);
    expect(expectRejection(sim, 'placeService', { service: 'park', ...water })).toContain('water');
    expect(
      expectRejection(sim, 'placeService', { service: 'park', x: base.x, y: streetY }),
      // "is a road", not the different "touches a road" refusal below.
    ).toContain('is a road');
    // Far from any road: nothing to walk in from.
    expect(
      expectRejection(sim, 'placeService', { service: 'park', x: base.x + 2, y: streetY + 4 }),
    ).toContain('touches a road');
    expect(
      expectRejection(sim, 'placeService', { service: 'park', x: GRID_WIDTH - 1, y: streetY - 2 }),
    ).toContain('outside');

    expect(
      sim.world.submit('placeService', { service: 'park', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();
    expect(
      expectRejection(sim, 'placeService', { service: 'park', x: base.x + 3, y: streetY - 2 }),
    ).toContain('a park');

    sim.world.runMaintenance(() => sim.world.setState('treasury', 5));
    const broke = expectRejection(sim, 'placeService', {
      service: 'park',
      x: base.x + 8,
      y: streetY - 2,
    });
    expect(broke).toContain('a park');
    expect(broke).toContain(String(SERVICE_COST.park));
  });

  it('lifts coverage, land value, and happiness around a park', () => {
    const { sim, base, streetY, citizen } = parkTown();
    const x = base.x + 1;
    const y = streetY + 1;
    for (let n = 0; n < 40; n++) sim.world.step();

    const coverageBefore = sim.scoreInputs.coverageCount(x, y);
    const valueBefore = sim.fields.landValue.getAt(x, y);
    const servicesBefore = happinessFactor(sim, citizen);

    expect(
      sim.world.submit('placeService', { service: 'park', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    // Past a full land-value recompute so the coverage change reaches the field.
    for (let n = 0; n < 40; n++) sim.world.step();

    expect(sim.scoreInputs.coverageCount(x, y)).toBe(coverageBefore + 1);
    expect(sim.fields.landValue.getAt(x, y)).toBeGreaterThan(valueBefore);
    expect(happinessFactor(sim, citizen)).toBeGreaterThan(servicesBefore);
  });

  it('does not stack coverage when parks overlap', () => {
    // The balance invariant the whole design rests on: because a park is cheap,
    // three of them must not buy three times the land value of one.
    const { sim, base, streetY } = parkTown();
    const home = { x: base.x + 1, y: streetY + 1 };
    for (const offset of [2, 5, 8]) {
      expect(
        sim.world.submit('placeService', { service: 'park', x: base.x + offset, y: streetY - 2 }),
      ).toBe(true);
      sim.world.step();
      expect(sim.fields.coverage.park.getAt(home.x, home.y)).toBe(1);
      expect(sim.scoreInputs.coverageCount(home.x, home.y)).toBe(1);
    }
    expect([...sim.world.query('structure')]).toHaveLength(3);
  });

  it('charges its upkeep every budget interval', () => {
    const { sim, base, streetY } = parkTown();
    let expenses = 0;
    sim.world.on('budget', (report) => {
      expenses = report.expenses;
    });
    stepUntil(sim, () => expenses > 0, BUDGET_INTERVAL_TICKS + 2);
    const withoutPark = expenses;

    expect(
      sim.world.submit('placeService', { service: 'park', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();
    const seen = expenses;
    stepUntil(sim, () => expenses !== seen, BUDGET_INTERVAL_TICKS + 2);
    // Roads are the only other expense here and they did not change.
    expect(expenses).toBe(withoutPark + SERVICE_UPKEEP.park);
  });

  it('paves the trees under its own footprint, exactly as a clinic does', () => {
    /** Land value on wooded ground after stamping one 2x2 service over it. */
    const onWoodedGround = (service: 'park' | 'clinic'): number => {
      const { sim, base, streetY } = parkTown();
      const anchor = { x: base.x + 2, y: streetY - 2 };
      // Trees ONLY under the footprint, so the block's tree bonus turns
      // entirely on whether this structure counts as having paved them.
      sim.terrain.trees.fill(0);
      for (const cell of footprintCells(anchor.x, anchor.y, 2, 2)) sim.terrain.trees[cell] = 1;
      expect(sim.world.submit('placeService', { service, ...anchor })).toBe(true);
      for (let n = 0; n < 40; n++) sim.world.step();
      return sim.fields.landValue.getAt(anchor.x, anchor.y);
    };
    // A park is a special building like the rest: it bulldozes its footprint
    // trees, so it keeps no tree bonus a clinic would not — the difference is 0.
    expect(onWoodedGround('park')).toBe(onWoodedGround('clinic'));
  });

  it('does not gate building level 3 — only a school does', () => {
    const { sim, base, streetY } = parkTown();
    const x = base.x + 1;
    const y = streetY + 1;
    expect(
      sim.world.submit('placeService', { service: 'park', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();
    expect(sim.scoreInputs.coverageCount(x, y)).toBe(1);
    expect(sim.scoreInputs.educated(x, y)).toBe(false);

    expect(
      sim.world.submit('placeService', { service: 'school', x: base.x + 6, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();
    expect(sim.scoreInputs.educated(x, y)).toBe(true);
  });

  it('loads a coverage mirror saved before parks existed', () => {
    const { sim, base, streetY } = parkTown();
    expect(
      sim.world.submit('placeService', { service: 'clinic', x: base.x + 20, y: streetY - 2 }),
    ).toBe(true);
    sim.world.step();

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const mirrors = (
      snapshot.components as Record<string, Array<[number, Record<string, unknown>]>>
    ).coverageMirror;
    expect(mirrors, 'no coverageMirror component in the snapshot').toHaveLength(1);
    for (const [, state] of mirrors) {
      expect(state.park).toBeDefined();
      // Exactly the shape a city saved before parks shipped carries.
      delete state.park;
    }

    const restored = createCitySim({ seed: 7, fieldsEnabled: true });
    restored.world.applySnapshot(snapshot);
    expect(() => rebuildDerived(restored)).not.toThrow();
    expect(restored.fields.coverage.clinic.getAt(base.x + 20, streetY - 2)).toBe(1);
    // The freshly-built empty layer stays in place, and is a real usable layer.
    expect(restored.fields.coverage.park.getAt(base.x + 20, streetY - 2)).toBe(0);
    expect(restored.scoreInputs.coverageCount(base.x + 20, streetY - 2)).toBe(1);
    restored.world.step();
    expect(
      restored.world.submit('placeService', { service: 'park', x: base.x + 2, y: streetY - 2 }),
    ).toBe(true);
    restored.world.step();
    expect(restored.fields.coverage.park.getAt(base.x + 2, streetY - 2)).toBe(1);
  });

  it('preserves parks across save, load, and replay', () => {
    const seed = 13;
    const town = parkTown({ seed, parkOffsets: [NEAR_PARK], activity: 'leisure' });
    const { sim, base, streetY } = town;
    for (let n = 0; n < 800; n++) sim.world.step();

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed, fieldsEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    const parks = [...restored.world.query('structure')].filter(
      (id) => restored.world.getComponent(id, 'structure')?.type === 'park',
    );
    expect(parks).toEqual(town.parks);
    expect(restored.fields.coverage.park.getAt(base.x + NEAR_PARK, streetY - 2)).toBe(1);
    // The 2x2 footprint is back in occupancy, so nothing can be built over it.
    expect(restored.occupiedCells.get(restored.terrain.width * (streetY - 2) + base.x + NEAR_PARK))
      .toBe(parks[0]);

    for (let n = 0; n < 800; n++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(JSON.stringify(sim.world.serialize()));
  });
});
/** The household's services-coverage happiness contribution, live. */
function happinessFactor(sim: CitySim, citizen: number): number {
  const breakdown = computeHappiness(sim, citizen);
  if (!breakdown) throw new Error(`citizen ${citizen} has no happiness breakdown`);
  const factor = breakdown.factors.find((entry) => entry.id === 'services');
  if (!factor) throw new Error('happiness breakdown has no services factor');
  return factor.delta;
}
