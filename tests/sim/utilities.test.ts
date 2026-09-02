import { describe, expect, it } from 'vitest';
import { createCitySim, getTreasury, rebuildDerived } from '../../src/sim/city';
import { PIPE_COST_PER_CELL } from '../../src/sim/constants/utilities';
import {
  ABANDON_EVALS,
  ABANDON_SCORE,
  LEVEL_INTERVAL,
  UTILITY_ABANDON_EVALS,
} from '../../src/sim/constants/zoning';
import { TPS } from '../../src/sim/constants/map';
import { buildingScore, utilityAbandonThreshold } from '../../src/sim/buildings';
import { cellIndex, lPathCells } from '../../src/sim/grid';
import {
  buildDistrict,
  findBridgeSite,
  findConnectablePumpSpot,
  findLandBlock,
  stats,
} from './helpers';
import type { CitySim } from '../../src/sim/city';

function poweredCounts(sim: CitySim) {
  let powered = 0;
  let unpowered = 0;
  let abandoned = 0;
  for (const id of sim.world.query('building')) {
    const b = sim.world.getComponent(id, 'building');
    if (!b) continue;
    if (b.abandoned) abandoned++;
    else if (b.powered) powered++;
    else unpowered++;
  }
  return { powered, unpowered, abandoned };
}

/**
 * Winds every building's unsupplied streak to `short` evaluations below ITS OWN
 * grace. The grace is now spread per building, so a blanket step count either
 * misses the earliest deadline or has to run past the latest — this lands every
 * building exactly on its own boundary, and keeps the test off the 4-minute
 * wall-clock the real grace represents.
 */
function ageUtilityStreak(sim: CitySim, short: number): void {
  sim.world.runMaintenance(() => {
    for (const id of [...sim.world.query('building')]) {
      const threshold = utilityAbandonThreshold(id);
      sim.world.patchComponent(id, 'building', (b) => {
        b.badUtilityEvals = Math.max(0, threshold - short);
      });
    }
  });
}

/**
 * Winds every building to the SAME elapsed streak — which is what real play
 * produces, since a district loses power on one tick. The spread lives in the
 * thresholds, so this is the setup under which buildings separate.
 */
function setUtilityStreak(sim: CitySim, evals: number): void {
  sim.world.runMaintenance(() => {
    for (const id of [...sim.world.query('building')]) {
      sim.world.patchComponent(id, 'building', (b) => {
        b.badUtilityEvals = evals;
      });
    }
  });
}

function seedDryBuilding(sim: CitySim, x: number, y: number): number {
  let entity = -1;
  sim.world.runMaintenance(() => {
    entity = sim.world.createEntity();
    sim.world.setPosition(entity, { x, y });
    sim.world.addComponent(entity, 'building', {
      zone: 'R',
      level: 1,
      w: 1,
      h: 1,
      residents: 0,
      jobsFilled: 0,
      abandoned: false,
      upEvals: 0,
      badEvals: 0,
      badUtilityEvals: 0,
      recoverEvals: 0,
      powered: true,
      watered: false,
    });
  });
  return entity;
}


describe('power network', () => {
  it('unpowered buildings abandon on the utility grace period and recover when powered', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    const grown = poweredCounts(sim);
    expect(grown.powered + grown.unpowered).toBeGreaterThan(0);

    // No plant anywhere: flood-fill marks everything unpowered.
    for (let i = 0; i < 20; i++) sim.world.step();
    expect(poweredCounts(sim).powered).toBe(0);

    // Each building's own grace expires → abandonment (unwatered counts through
    // the same streak). Wound to one evaluation short of every deadline, then
    // stepped past it.
    ageUtilityStreak(sim, 1);
    for (let i = 0; i < LEVEL_INTERVAL * 3; i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBeGreaterThan(0);

    // Power + water the district: coal plant + pump + pipe along the spine.
    const spineY = base.y + 2;
    expect(
      sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x, y: spineY + 4 }),
    ).toBe(true);
    const pumpAt = findConnectablePumpSpot(sim, { x: base.x + 8, y: spineY });
    expect(sim.world.submit('placeWaterPump', { x: pumpAt.x, y: pumpAt.y })).toBe(true);
    sim.world.step();
    // Pipe from the pump to the district spine (pipes cross terrain and run under structures).
    expect(
      sim.world.submit('placePipe', { ax: pumpAt.x, ay: pumpAt.y, bx: base.x + 8, by: spineY }),
    ).toBe(true);
    // Buildings do not relay water, so the main has to run the whole spine
    // rather than touching it at one point (see tests/sim/conduction.test.ts).
    expect(
      sim.world.submit('placePipe', { ax: base.x, ay: spineY, bx: base.x + 15, by: spineY }),
    ).toBe(true);
    // Power lines from the plant along the spine.
    expect(
      sim.world.submit('placePowerLine', {
        ax: base.x,
        ay: spineY + 3,
        bx: base.x + 15,
        by: spineY + 3,
      }),
    ).toBe(true);
    for (let i = 0; i < 16 * 10; i++) sim.world.step();

    const after = poweredCounts(sim);
    expect(after.powered).toBeGreaterThan(0);
    expect(after.abandoned).toBeLessThan(poweredCounts(sim).abandoned + 1); // recovery in progress or done
    // Run further: all recovered buildings powered.
    for (let i = 0; i < 16 * 10; i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(0);
  });

  it('gives a new player minutes, not seconds, before an unsupplied district empties', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    const grown = poweredCounts(sim);
    expect(grown.powered + grown.unpowered).toBeGreaterThan(4);

    // The measured complaint: at the old 75-eval grace a starter district was
    // completely empty 81 seconds after the first resident arrived. Every
    // building must now still be standing well past that point.
    const oldGraceTicks = LEVEL_INTERVAL * 75;
    for (let i = 0; i < oldGraceTicks * 2; i++) sim.world.step();

    expect(poweredCounts(sim).abandoned).toBe(0);
    expect(UTILITY_ABANDON_EVALS * LEVEL_INTERVAL / TPS).toBeGreaterThanOrEqual(180);
  });

  it('empties an unsupplied district as a drift, never all at once', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    const counts = poweredCounts(sim);
    const total = counts.unpowered + counts.powered;
    expect(total).toBeGreaterThan(4);

    // Read the district's real deadlines rather than assuming where they fall:
    // the spread is entity-id arithmetic, so which building goes first depends
    // on allocation order. (query() is a single-use generator — spread once.)
    const thresholds = [...sim.world.query('building')].map(utilityAbandonThreshold);
    const earliest = Math.min(...thresholds);
    const latest = Math.max(...thresholds);
    // Non-vacuous: if every building shared one deadline this test would prove
    // nothing, so assert the spread actually separated THIS district.
    expect(latest).toBeGreaterThan(earliest);

    // One shared elapsed streak, just short of the earliest deadline — exactly
    // what a district that lost power together looks like.
    setUtilityStreak(sim, earliest - 1);
    for (let i = 0; i < LEVEL_INTERVAL * 2; i++) sim.world.step();

    const partial = poweredCounts(sim).abandoned;
    expect(partial).toBeGreaterThan(0);
    // The cliff this replaced: before the spread, that was every building.
    expect(partial).toBeLessThan(total);

    // The rest do follow, so the mechanic still has teeth.
    for (let i = 0; i < LEVEL_INTERVAL * (latest - earliest + 4); i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(total);
  });

  /**
   * A counter documented as "N CONSECUTIVE evaluations of X" must be cleared on
   * EVERY not-X branch, including the healthy fall-through — not only on the
   * terminal transitions. A reset that lives only on abandon and recover looks
   * complete and silently accumulates across brief recoveries: a building that
   * banked most of its grace while unpowered, regained power for a single
   * evaluation, then lost it again, died within a few evaluations instead of
   * getting a fresh grace. Brownout flicker on an undersized plant reaches that
   * state on its own.
   *
   * The doc already said "consecutive". The code enforced it on one path only.
   */
  it('regaining utilities resets the utility-abandon streak (no premature abandon on flicker)', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    // Drive the utility signal directly so we can flicker it precisely; the
    // score is otherwise healthy (default land value, no pollution).
    let hasPower = true;
    const baseInputs = sim.scoreInputs;
    sim.scoreInputs = { ...baseInputs, powered: () => hasPower, watered: () => true };
    const base = findLandBlock(sim, 18, 8);
    buildDistrict(sim, 'R', base);
    for (let i = 0; i < 400; i++) sim.world.step();
    // Grown + healthy via the override (b.powered stays false — no real plant).
    expect(poweredCounts(sim).unpowered).toBeGreaterThan(0);
    expect(poweredCounts(sim).abandoned).toBe(0);

    // Cut utilities and accumulate the utility-abandon streak to just under the
    // grace (never crossing it).
    hasPower = false;
    ageUtilityStreak(sim, 9);
    for (let i = 0; i < LEVEL_INTERVAL * 8; i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(0);

    // Restore utilities briefly — the buildings are fully healthy again, which
    // must clear the utility-abandon streak.
    hasPower = true;
    for (let i = 0; i < LEVEL_INTERVAL * 3; i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(0);

    // Lose utilities again: with a *fresh* grace, nothing abandons within a
    // dozen evals. Without the reset the streak resumed near the cap and would
    // cross UTILITY_ABANDON_EVALS almost immediately.
    hasPower = false;
    for (let i = 0; i < LEVEL_INTERVAL * 12; i++) sim.world.step();
    expect(poweredCounts(sim).abandoned).toBe(0);
  });

  /**
   * When one scalar folds in a concern that already owns a timer, the two timers
   * race and the shorter one wins — silently, because the scalar does not say
   * which of its terms moved. Desirability `score` includes +10 for "powered &&
   * watered", so a building missing utilities loses those 10 points and can fall
   * under ABANDON_SCORE on land value alone; abandonment then fires on the FAST
   * score path instead of the long utility grace that exists to prevent exactly
   * this. A missing utility was laundered into a verdict of "bad location".
   *
   * Keep a fast path measuring only what it names, and let the concern that has
   * its own grace own its own timeline.
   *
   * This test is worth nothing unless its fixture actually reaches the losing
   * condition, and it silently stopped reaching it once already: the original
   * ran 25 evaluations against an ABANDON_EVALS that later grew to 60, so the
   * fast path could not have fired even with the guard deleted. The explicit
   * preconditions below fail loudly if that happens again.
   */
  it('keeps the full utility grace where pollution depresses land value (onboarding)', () => {
    const sim = createCitySim({ seed: 7, fieldsEnabled: true, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    // Establish the unpowered district on neutral land — the grace holds here.
    for (let i = 0; i < 400; i++) sim.world.step();
    const grown = poweredCounts(sim);
    expect(grown.powered + grown.unpowered).toBeGreaterThan(0);
    expect(grown.powered).toBe(0); // no plant wired
    expect(grown.abandoned).toBe(0);

    // A coal plant beside the homes: a pollution source that depresses land
    // value. We deliberately do NOT wire power — the ONLY faults are "missing
    // utilities" (its own grace) and pollution-lowered land value.
    expect(sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x + 6, y: base.y + 6 })).toBe(
      true,
    );

    // Long past the fast score path, still well inside the utility grace
    // (UTILITY_ABANDON_EVALS, before its per-building spread).
    const evaluations = 200;
    expect(evaluations).toBeGreaterThan(ABANDON_EVALS);
    expect(evaluations).toBeLessThan(UTILITY_ABANDON_EVALS);
    for (let i = 0; i < LEVEL_INTERVAL * evaluations; i++) sim.world.step();

    // While utilities are missing, only the utility grace may end a building.
    expect(
      poweredCounts(sim).abandoned,
      'homes abandoned inside the utility grace — the missing-utility score penalty tripped ' +
        'the fast score path, which is the grace being bypassed rather than a bad location',
    ).toBe(0);

    // And the precondition, checked after: some home is unpowered AND scoring
    // under the abandonment line AND has already banked more consecutive
    // bad-score evaluations than the fast path needs. Without it the fast path
    // is being held back by nothing and the assertion above is decoration.
    let heldBackFromScorePath = 0;
    for (const id of [...sim.world.query('building', 'position')].sort((a, b) => a - b)) {
      const building = sim.world.getComponent(id, 'building');
      const position = sim.world.getComponent(id, 'position');
      if (!building || !position || building.abandoned) continue;
      const { score, utilitiesOk } = buildingScore(sim, id, building, position);
      if (!utilitiesOk && score < ABANDON_SCORE && building.badEvals >= ABANDON_EVALS) {
        heldBackFromScorePath++;
      }
    }
    expect(
      heldBackFromScorePath,
      'fixture no longer reaches the losing condition: no unpowered home is under ' +
        'ABANDON_SCORE with a wound-up score streak, so nothing here exercises the guard',
    ).toBeGreaterThan(0);
  });

  it('brownout powers the ascending-id prefix deterministically', () => {
    const run = () => {
      const sim = createCitySim({ seed: 11, utilitiesEnabled: true });
      const base = findLandBlock(sim, 18, 18);
      buildDistrict(sim, 'R', base);
      // Wind turbine: capacity 40 < district demand once grown.
      expect(
        sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x, y: base.y + 8 }),
      ).toBe(true);
      // Wire the WHOLE district, so every building is attached to the one
      // network and the only reason to be unpowered is the brownout prefix.
      // (Buildings no longer relay supply, so an unwired building would be
      // unpowered for lack of reach and would muddle the ordering assertion.)
      expect(
        sim.world.submit('placePowerLine', {
          ax: base.x,
          ay: base.y + 8,
          bx: base.x,
          by: base.y + 2,
        }),
      ).toBe(true);
      expect(
        sim.world.submit('placePowerLine', {
          ax: base.x,
          ay: base.y + 2,
          bx: base.x + 15,
          by: base.y + 2,
        }),
      ).toBe(true);
      for (let i = 0; i < 900; i++) sim.world.step();
      const powered: number[] = [];
      const unpowered: number[] = [];
      for (const id of [...sim.world.query('building')].sort((a, b) => a - b)) {
        const b = sim.world.getComponent(id, 'building');
        if (!b || b.abandoned) continue;
        (b.powered ? powered : unpowered).push(id);
      }
      return { powered, unpowered };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    if (a.powered.length > 0 && a.unpowered.length > 0) {
      // Ascending-id prefix: every powered id below every unpowered id within the network.
      expect(Math.max(...a.powered)).toBeLessThan(Math.min(...a.unpowered));
    }
  });
});

describe('water network', () => {
  it('lays and charges for an underground pipe across lake cells', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const site = findBridgeSite(sim);
    const from = { x: site.x0, y: site.y };
    const to = { x: site.x1, y: site.y };
    const path = lPathCells(from, to);
    const waterCells = path.filter(
      ({ x, y }) => sim.terrain.water[cellIndex(x, y)] === 1,
    );
    const before = getTreasury(sim.world);

    expect(waterCells.length).toBeGreaterThan(0);
    expect(
      sim.world.submit('placePipe', { ax: from.x, ay: from.y, bx: to.x, by: to.y }),
    ).toBe(true);
    sim.world.step();

    expect(path.every(({ x, y }) => sim.pipeCells.has(cellIndex(x, y)))).toBe(true);
    expect(getTreasury(sim.world)).toBe(before - path.length * PIPE_COST_PER_CELL);
  });

  it('conducts water across a lake and rebuilds the same water-cell pipes after load', () => {
    const config = { seed: 7, utilitiesEnabled: true } as const;
    const sim = createCitySim(config);
    const site = findBridgeSite(sim);
    const pump = { x: site.x0 + 7, y: site.y };
    const destination = { x: site.x1, y: site.y };
    const building = seedDryBuilding(sim, destination.x, destination.y);

    expect(sim.world.submit('placeWaterPump', pump)).toBe(true);
    sim.world.step();
    expect(
      sim.world.submit('placePipe', {
        ax: pump.x,
        ay: pump.y,
        bx: destination.x,
        by: destination.y,
      }),
    ).toBe(true);
    for (let i = 0; i < 16; i++) sim.world.step();

    expect(sim.world.getComponent(building, 'building')?.watered).toBe(true);
    const waterPipeCells = [...sim.pipeCells.keys()].filter(
      (index) => sim.terrain.water[index] === 1,
    );
    expect(waterPipeCells.length).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim(config);
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    expect([...restored.pipeCells.keys()].sort((a, b) => a - b)).toEqual(
      [...sim.pipeCells.keys()].sort((a, b) => a - b),
    );
    expect(waterPipeCells.every((index) => restored.pipeCells.has(index))).toBe(true);
    for (let i = 0; i < 16; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(JSON.stringify(sim.world.serialize()));
  });

  it('rejects pumps away from water and accepts pipes under roads', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    // findLandBlock guarantees an all-land block: its center is not water-adjacent
    // ... unless the block borders water; use strictly interior cell of the block.
    expect(sim.world.submit('placeWaterPump', { x: base.x + 9, y: base.y + 9 })).toBe(false);

    buildDistrict(sim, 'R', base);
    // Pipe along the road spine (under the road) is legal.
    const spineY = base.y + 2;
    expect(
      sim.world.submit('placePipe', { ax: base.x, ay: spineY, bx: base.x + 15, by: spineY }),
    ).toBe(true);
    sim.world.step();
  });
});

describe('broke-state escape', () => {
  it('blocks roads while broke but allows utility purchases', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    sim.world.runMaintenance(() => sim.world.setState('treasury', -500));
    expect(
      sim.world.submit('placeRoad', { ax: base.x, ay: base.y, bx: base.x + 3, by: base.y }),
    ).toBe(false);
    expect(
      sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x + 5, y: base.y + 5 }),
    ).toBe(true);
    sim.world.step();
    expect(getTreasury(sim.world)).toBeLessThan(-500); // purchase applied while negative
  });
});

describe('utilities save/load', () => {
  it('replays identically after snapshot restore mid-simulation', () => {
    const sim = createCitySim({ seed: 7, utilitiesEnabled: true });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    sim.world.submit('placePowerPlant', { kind: 'wind', x: base.x, y: base.y + 8 });
    for (let i = 0; i < 600; i++) sim.world.step();
    expect(stats(sim).citizens).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 7, utilitiesEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);
    for (let i = 0; i < 300; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(JSON.stringify(sim.world.serialize()));
  });
});
