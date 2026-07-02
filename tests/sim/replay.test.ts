import { describe, expect, it } from 'vitest';
import { MemorySink, SessionRecorder, SessionReplayer, type SessionBundle } from 'civ-engine';
import { createCitySim, rebuildDerived, type CitySimConfig } from '../../src/sim/city';
import {
  buildDistrict,
  findBridgeStub,
  findConnectablePumpSpot,
  findLandBlock,
  stats,
} from './helpers';
import type { CityCommands, CityEvents } from '../../src/sim/types';

/**
 * The project determinism gate (AGENTS.md § civ-engine usage rules): record a
 * real play session — commands, growth, citizens, traffic, a mid-run road
 * edit — and verify the engine's 3-stream replay self-check. This catches
 * closure-state leaks, Map-iteration nondeterminism, and derived caches not
 * restored by rebuildDerived.
 */
describe('session replay self-check', () => {
  it('replays a recorded session identically', { timeout: 60_000 }, () => {
    // Match the shipping worker's config (both feature flags on) so the gate
    // covers fields, utilities, services, taxes, and bulldozeRect — not just
    // roads and zoning.
    const config: CitySimConfig = { seed: 7, fieldsEnabled: true, utilitiesEnabled: true };
    const sim = createCitySim(config);
    const sink = new MemorySink();
    const recorder = new SessionRecorder({ world: sim.world, sink });
    recorder.connect();

    const base = findLandBlock(sim, 18, 18);
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 10 });
    const midX = base.x + 8;
    sim.world.submit('placeRoad', { ax: midX, ay: base.y + 2, bx: midX, by: base.y + 12 });
    sim.world.submit('placePowerPlant', { kind: 'coal', x: base.x, y: base.y + 7 });
    sim.world.submit('setTaxRate', { zone: 'R', rate: 12 });
    sim.world.step();
    sim.world.submit('placePowerLine', {
      ax: base.x + 1,
      ay: base.y + 6,
      bx: base.x + 14,
      by: base.y + 6,
    });
    sim.world.submit('placeService', { service: 'fireStation', x: base.x + 12, y: base.y + 5 });
    sim.world.step();
    const pump = findConnectablePumpSpot(sim, { x: midX, y: base.y + 2 });
    sim.world.submit('placeWaterPump', { x: pump.x, y: pump.y });
    sim.world.step();
    sim.world.submit('placePipe', { ax: pump.x, ay: pump.y, bx: midX, by: base.y + 2 });
    sim.world.submit('placePipe', { ax: midX, ay: base.y + 2, bx: midX, by: base.y + 12 });
    // A bridge stub keeps the gate's coverage in sync with bridge pricing.
    // Asserted so a validator rejection can't silently drop the coverage.
    const stub = findBridgeStub(sim);
    expect(
      sim.world.submit('placeRoad', {
        ax: stub.x,
        ay: stub.y,
        bx: stub.x + 2 * stub.dx,
        by: stub.y + 2 * stub.dy,
      }),
    ).toBe(true);
    for (let i = 0; i < 700; i++) sim.world.step();

    // Mid-run topology edits while traffic may be in flight, plus a rect
    // bulldoze that clears buildings/structures/utilities together.
    sim.world.submit('bulldozeRoad', { ax: midX, ay: base.y + 6, bx: midX, by: base.y + 6 });
    sim.world.submit('placeRoad', { ax: midX, ay: base.y + 6, bx: midX, by: base.y + 6 });
    sim.world.submit('bulldozeRect', {
      ax: base.x + 12,
      ay: base.y + 5,
      bx: base.x + 14,
      by: base.y + 7,
    });
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
