import { describe, expect, it } from 'vitest';
import { MemorySink, SessionRecorder, SessionReplayer, type SessionBundle } from 'civ-engine';
import { createCitySim, rebuildDerived, type CitySimConfig } from '../../src/sim/city';
import { buildDistrict, findLandBlock, stats } from './helpers';
import type { CityCommands, CityEvents } from '../../src/sim/types';

/**
 * The project determinism gate (AGENTS.md § civ-engine usage rules): record a
 * real play session — commands, growth, citizens, traffic, a mid-run road
 * edit — and verify the engine's 3-stream replay self-check. This catches
 * closure-state leaks, Map-iteration nondeterminism, and derived caches not
 * restored by rebuildDerived.
 */
describe('session replay self-check', () => {
  it('replays a recorded session identically', () => {
    const config: CitySimConfig = { seed: 7, fieldsEnabled: true };
    const sim = createCitySim(config);
    const sink = new MemorySink();
    const recorder = new SessionRecorder({ world: sim.world, sink });
    recorder.connect();

    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 10 });
    const midX = base.x + 8;
    sim.world.submit('placeRoad', { ax: midX, ay: base.y + 2, bx: midX, by: base.y + 12 });
    for (let i = 0; i < 700; i++) sim.world.step();

    // Mid-run topology edit while traffic may be in flight.
    sim.world.submit('bulldozeRoad', { ax: midX, ay: base.y + 6, bx: midX, by: base.y + 6 });
    sim.world.submit('placeRoad', { ax: midX, ay: base.y + 6, bx: midX, by: base.y + 6 });
    for (let i = 0; i < 500; i++) sim.world.step();

    expect(stats(sim).citizens).toBeGreaterThan(0);
    recorder.disconnect();
    // toBundle() is untyped (SessionBundle<Record<string, never>, ...>); retype
    // it so fromBundle's TEventMap/TCommandMap match the worldFactory's world.
    const bundle = recorder.toBundle() as unknown as SessionBundle<CityEvents, CityCommands>;

    const replayer = SessionReplayer.fromBundle(bundle, {
      worldFactory: (snapshot) => {
        const replaySim = createCitySim(config);
        replaySim.world.applySnapshot(snapshot);
        rebuildDerived(replaySim);
        return replaySim.world;
      },
    });
    const result = replayer.selfCheck();
    expect(result.ok, JSON.stringify(result, null, 2).slice(0, 2000)).toBe(true);
  });
});
