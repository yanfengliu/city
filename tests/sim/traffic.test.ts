import { describe, expect, it } from 'vitest';
import { createCitySim, rebuildDerived } from '../../src/sim/city';
import { buildDistrict, findLandBlock, stats } from './helpers';

/**
 * Connected R + I districts sharing one road network: R spine at base.y+2,
 * vertical connector, I spine at base.y+12.
 */
function buildCommuterTown(sim: ReturnType<typeof createCitySim>) {
  const base = findLandBlock(sim, 18, 18);
  buildDistrict(sim, 'R', base);
  buildDistrict(sim, 'I', { x: base.x, y: base.y + 10 });
  const midX = base.x + 8;
  expect(
    sim.world.submit('placeRoad', { ax: midX, ay: base.y + 2, bx: midX, by: base.y + 12 }),
  ).toBe(true);
  sim.world.step();
  return base;
}

function stepUntil(
  sim: ReturnType<typeof createCitySim>,
  predicate: () => boolean,
  maxTicks: number,
): boolean {
  for (let i = 0; i < maxTicks; i++) {
    sim.world.step();
    if (predicate()) return true;
  }
  return predicate();
}

describe('employment and commuting', () => {
  it('citizens get jobs and vehicles flow on a connected network', () => {
    const sim = createCitySim({ seed: 7 });
    buildCommuterTown(sim);

    expect(stepUntil(sim, () => stats(sim).employed > 0, 1200)).toBe(true);
    expect(stepUntil(sim, () => stats(sim).vehicles > 0, 600)).toBe(true);

    // Vehicles occupy edges while moving.
    let sawEdgeTraffic = false;
    for (let i = 0; i < 64 && !sawEdgeTraffic; i++) {
      sim.world.step();
      for (const count of sim.edgeCounts.values()) {
        if (count > 0) sawEdgeTraffic = true;
      }
    }
    expect(sawEdgeTraffic).toBe(true);
    expect(stats(sim).disconnected).toBe(0);

    // Round trips complete: eventually some commuter reaches 'atWork'.
    const phases = new Set<string>();
    for (let i = 0; i < 400; i++) {
      sim.world.step();
      for (const id of sim.world.query('citizen')) {
        const c = sim.world.getComponent(id, 'citizen');
        if (c) phases.add(c.phase);
      }
    }
    expect(phases.has('atWork')).toBe(true);
  });

  it('counts disconnected trips when districts are on separate networks', () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 10 }); // parallel spines, no connector

    expect(stepUntil(sim, () => stats(sim).disconnected > 0, 2000)).toBe(true);
    expect(stats(sim).vehicles).toBe(0);
  });

  it('stays deterministic with traffic running', () => {
    const run = () => {
      const sim = createCitySim({ seed: 11 });
      buildCommuterTown(sim);
      for (let i = 0; i < 900; i++) sim.world.step();
      return JSON.stringify(sim.world.serialize());
    };
    expect(run()).toBe(run());
  });

  it('replays identically after save/load mid-traffic', () => {
    const sim = createCitySim({ seed: 7 });
    buildCommuterTown(sim);
    stepUntil(sim, () => stats(sim).vehicles > 0, 1600);
    for (let i = 0; i < 100; i++) sim.world.step();

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 7 });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    for (let i = 0; i < 200; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(
      JSON.stringify(sim.world.serialize()),
    );
  });

  it('handles road edits while traffic is in flight', () => {
    const sim = createCitySim({ seed: 7 });
    const base = buildCommuterTown(sim);
    stepUntil(sim, () => stats(sim).vehicles > 0, 1600);

    // Cut the vertical connector mid-flight.
    const midX = base.x + 8;
    expect(
      sim.world.submit('bulldozeRoad', {
        ax: midX,
        ay: base.y + 6,
        bx: midX,
        by: base.y + 7,
      }),
    ).toBe(true);
    sim.world.step();

    // Edge counts must stay consistent with live vehicles after the remap.
    let counted = 0;
    for (const count of sim.edgeCounts.values()) counted += count;
    expect(counted).toBe(stats(sim).vehicles);

    // The sim keeps running without tick failures.
    for (let i = 0; i < 300; i++) sim.world.step();
    expect(sim.world.isPoisoned()).toBe(false);
  });

  it('survives massive topology destruction under in-flight vehicles (regression: stale edge ids)', () => {
    // Regression for the dead-code refreshRoads(sim) bug: vehicles kept edge
    // ids into the rebuilt (smaller) graph — silent teleports or a poisoned
    // world once an id indexed past the shrunken edges array.
    const sim = createCitySim({ seed: 7 });
    const base = buildCommuterTown(sim);
    stepUntil(sim, () => stats(sim).vehicles > 0, 1600);
    expect(stats(sim).vehicles).toBeGreaterThan(0);

    // Destroy the whole I-spine AND the connector: most edges vanish.
    expect(
      sim.world.submit('bulldozeRect', {
        ax: base.x,
        ay: base.y + 6,
        bx: base.x + 15,
        by: base.y + 14,
      }),
    ).toBe(true);
    sim.world.step();

    // Every surviving vehicle must reference a valid edge of the NEW graph.
    for (const id of [...sim.world.query('vehicle')]) {
      const data = sim.world.getComponent(id, 'vehicle');
      if (!data) continue;
      for (const leg of data.legs) {
        expect(leg.edge).toBeLessThan(sim.roadGraph.edges.length);
      }
    }
    // Edge counts stay consistent with live vehicles after the remap/culls.
    let counted = 0;
    for (const count of sim.edgeCounts.values()) counted += count;
    expect(counted).toBe(stats(sim).vehicles);

    for (let i = 0; i < 400; i++) sim.world.step();
    expect(sim.world.isPoisoned()).toBe(false);
  });
});
