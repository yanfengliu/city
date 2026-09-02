import { describe, expect, it } from 'vitest';
import { createCitySim, rebuildDerived } from '../../src/sim/city';
import { edgeKey } from '../../src/sim/traffic/topology';
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

  it('counts disconnected trips when the only connector is severed mid-employment', () => {
    // Employment is route-based, so separate networks yield no assignments at
    // all (tests/sim/employment.test.ts). Disconnected trips still happen when
    // the topology is destroyed AFTER assignment: commuters keep their jobs
    // but their next trip finds no route.
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 10 });
    const midX = base.x + 8;
    expect(
      sim.world.submit('placeRoad', { ax: midX, ay: base.y + 2, bx: midX, by: base.y + 12 }),
    ).toBe(true);
    expect(stepUntil(sim, () => stats(sim).employed > 0, 2000)).toBe(true);

    // Sever the connector between the spines (keep both spines intact).
    expect(
      sim.world.submit('bulldozeRoad', { ax: midX, ay: base.y + 3, bx: midX, by: base.y + 11 }),
    ).toBe(true);
    expect(stepUntil(sim, () => stats(sim).disconnected > 0, 2000)).toBe(true);
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

  /**
   * A parameter a caller may omit is a parameter a caller WILL omit. Behavior
   * that must run does not belong behind an optional argument: `refreshRoads`
   * remaps in-flight vehicles onto the rebuilt graph only when it is handed the
   * world, so a command handler written `refreshRoads(sim)` still compiles,
   * still rebuilds the graph, and silently skips the remap. The remap has no
   * other caller, so nothing fails until the exact scenario arrives.
   *
   * Gate the behavior the argument buys, not the survival of the process. Every
   * rebuild reassigns edge ids, so the question is whether each car is still on
   * the road it was on. "Nothing crashed" and "the id is in range" both pass
   * with the defect live, because a stale id still names SOME edge — and a
   * scenario that culls every car passes while comparing nothing at all.
   */
  it('keeps in-flight cars on the same road when a rebuild renumbers edges', () => {
    const sim = createCitySim({ seed: 7 });
    buildCommuterTown(sim);
    stepUntil(sim, () => stats(sim).vehicles > 0, 1600);

    // Where each in-flight car is, recorded by geometry rather than by id.
    const before = new Map<number, { citizen: number; ids: number[]; keys: string[] }>();
    for (const id of [...sim.world.query('vehicle')].sort((a, b) => a - b)) {
      const data = sim.world.getComponent(id, 'vehicle');
      if (!data) continue;
      before.set(id, {
        citizen: data.citizen,
        ids: data.legs.map((leg) => leg.edge),
        keys: data.legs.map((leg) => edgeKey(sim.roadGraph.edges[leg.edge])),
      });
    }
    expect(before.size).toBeGreaterThan(0);

    // A disconnected stub at a low cell index: it renumbers the whole edge
    // array without touching the geometry any car is driving on, so every car
    // must survive AND stay put. Cutting the road under the cars instead would
    // cull them all and leave nothing to compare.
    const stub = findLandBlock(sim, 3, 1);
    expect(
      sim.world.submit('placeRoad', { ax: stub.x, ay: stub.y, bx: stub.x + 2, by: stub.y }),
    ).toBe(true);
    sim.world.step();

    // Entity ids recycle, so only compare cars still driven by the same
    // citizen.
    let survivors = 0;
    let renumbered = 0;
    for (const [id, snapshot] of before) {
      const data = sim.world.getComponent(id, 'vehicle');
      if (!data || data.citizen !== snapshot.citizen) continue;
      survivors++;
      const ids = data.legs.map((leg) => leg.edge);
      const keys = data.legs.map((leg) => {
        const edge = sim.roadGraph.edges[leg.edge];
        return edge ? edgeKey(edge) : `no edge ${leg.edge}`;
      });
      if (JSON.stringify(ids) !== JSON.stringify(snapshot.ids)) renumbered++;
      expect(keys, `vehicle ${id} must still be on the road it was on`).toEqual(snapshot.keys);
    }
    // Both guards fail loudly if the fixture stops exercising the case: a run
    // with no survivor compares nothing, and a run that renumbered no leg would
    // pass even with the remap deleted.
    expect(survivors).toBeGreaterThan(0);
    expect(renumbered).toBeGreaterThan(0);
  });

  it('survives massive topology destruction under in-flight vehicles (regression: stale edge ids)', () => {
    // Regression for the dead-code refreshRoads(sim) bug: vehicles kept edge
    // ids into the rebuilt (smaller) graph — silent teleports or a poisoned
    // world once an id indexed past the shrunken edges array. This rect also
    // destroys the buildings, so it culls every car; the surviving-car identity
    // check lives in "handles road edits while traffic is in flight", where
    // cars actually survive.
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
