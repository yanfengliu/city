import { describe, expect, it } from 'vitest';
import { createCitySim, rebuildDerived, type CitySim, type CitySimConfig } from '../../src/sim/city';
import { buildDistrict, findConnectablePumpSpot, findLandBlock } from './helpers';

/**
 * Every derived cache is written twice: once incrementally by the live command
 * handler, and once wholesale by `rebuildDerived` after a snapshot load. A
 * special case added to only one of them is invisible until someone reloads —
 * and then the same command is accepted before the reload and refused after it,
 * or the reverse. The bug lives in the handler you did edit; the divergence is
 * only visible against the path you did not.
 *
 * The replay self-check cannot see this: these caches are derived and never
 * serialized, so a corrupted cache replays identically to a clean one. The
 * check that does see it is this one — derived state must be a pure function of
 * serialized world state, so playing forwards and rebuilding from the snapshot
 * must land on byte-identical caches.
 *
 * Add commands here whenever a handler learns a new special case; a cache this
 * scenario never dirties is a cache this gate does not cover.
 */

const CONFIG: CitySimConfig = {
  seed: 7,
  fieldsEnabled: true,
  utilitiesEnabled: true,
  highwayEnabled: true,
};

/** Every game-owned cache `rebuildDerived` is responsible for restoring. */
function derivedCaches(sim: CitySim): Record<string, unknown> {
  const sorted = <V,>(map: Map<number, V>) =>
    [...map.entries()].sort((a, b) => a[0] - b[0]);
  return {
    roadCells: [...sim.roadCells].sort((a, b) => a - b),
    roadGraphEdges: sim.roadGraph.edges.map((e) => `${e.a}>${e.b}>${e.cells[1] ?? -1}>${e.length}`),
    zoneCells: sorted(sim.zoneCells),
    zoneEntities: sorted(sim.zoneEntities),
    occupiedCells: sorted(sim.occupiedCells),
    powerLineCells: sorted(sim.powerLineCells),
    pipeCells: sorted(sim.pipeCells),
    edgeCounts: sorted(sim.edgeCounts),
    edgeBuckets: sorted(sim.edgeBuckets),
  };
}

describe('derived caches are a pure function of serialized state', () => {
  it('lands on identical caches whether played forwards or rebuilt from the snapshot', () => {
    const sim = createCitySim(CONFIG);
    const base = findLandBlock(sim, 18, 18);

    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 10 });
    const midX = base.x + 8;
    sim.world.submit('placeRoad', { ax: midX, ay: base.y + 2, bx: midX, by: base.y + 12 });
    sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x, y: base.y + 7 });
    sim.world.step();

    // Overlays that cross an owner (a road, a building) and bare ground alike.
    sim.world.submit('placePowerLine', {
      ax: base.x + 1,
      ay: base.y + 6,
      bx: base.x + 14,
      by: base.y + 6,
    });
    sim.world.submit('placeService', { service: 'fireStation', x: base.x + 12, y: base.y + 5 });
    sim.world.step();

    const pump = findConnectablePumpSpot(sim, { x: midX, y: base.y + 2 });
    expect(sim.world.submit('placeWaterPump', { x: pump.x, y: pump.y })).toBe(true);
    sim.world.step();
    sim.world.submit('placePipe', { ax: pump.x, ay: pump.y, bx: midX, by: base.y + 2 });
    sim.world.submit('placePipe', { ax: midX, ay: base.y + 2, bx: midX, by: base.y + 12 });
    sim.world.step();

    // Let buildings grow so occupancy has real multi-cell owners in it.
    for (let i = 0; i < 900; i++) sim.world.step();
    expect(sim.occupiedCells.size).toBeGreaterThan(0);
    expect(sim.powerLineCells.size).toBeGreaterThan(0);
    expect(sim.pipeCells.size).toBeGreaterThan(0);

    // Now the removal paths — the half of the ownership transition that is
    // easiest to forget, and the half a reload disagrees with.
    sim.world.submit('bulldozeRoad', { ax: midX, ay: base.y + 6, bx: midX, by: base.y + 6 });
    sim.world.step();
    // A rect that clips a multi-cell owner: the whole owner goes, including the
    // footprint cells outside the rect.
    sim.world.submit('bulldozeRect', {
      ax: base.x + 2,
      ay: base.y + 1,
      bx: base.x + 5,
      by: base.y + 4,
    });
    sim.world.step();
    // And one that takes the pump out from under its own pipes.
    sim.world.submit('bulldozeRect', { ax: pump.x, ay: pump.y, bx: pump.x, by: pump.y });
    sim.world.step();
    for (let i = 0; i < 60; i++) sim.world.step();

    const live = derivedCaches(sim);

    const reloaded = createCitySim(CONFIG);
    reloaded.world.applySnapshot(JSON.parse(JSON.stringify(sim.world.serialize())));
    rebuildDerived(reloaded);

    // Compare cache by cache — knowing which one moved is the whole diagnosis.
    const rebuilt = derivedCaches(reloaded);
    for (const key of Object.keys(live)) {
      expect(
        rebuilt[key],
        `${key} differs between the live path and rebuildDerived: a special case landed in ` +
          'one of them only, so the same command will be accepted before a reload and refused ' +
          'after it',
      ).toEqual(live[key]);
    }
  });
});
