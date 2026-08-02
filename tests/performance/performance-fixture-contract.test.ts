import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_FIXTURE_POST_ADVANCE_STATE,
  PERFORMANCE_FIXTURE_SEED,
  PERFORMANCE_FIXTURE_SHA256,
} from '../../scripts/performance-fixture-contract.mjs';
import { createCitySim, rebuildDerived } from '../../src/sim/city';
import { PEOPLE_PER_CITIZEN } from '../../src/sim/constants/zoning';
import { simSummary } from '../../src/sim/summary';
import { MovingAgentMessageSync } from '../../src/worker/pedestrian-projection';
import { CITY_WORKER_SIM_FLAGS } from '../../src/worker/sim-config';

const fixtureText = readFileSync('benchmarks/fixtures/performance-city-save.json', 'utf8');
const generatorSource = readFileSync('scripts/generate-performance-fixture.mjs', 'utf8');
const fixture = JSON.parse(fixtureText) as {
  meta: { seed: number };
  snapshot: { tick: number } & Record<string, unknown>;
};

describe('canonical performance fixture contract', () => {
  it('replays one tick to the exact workload projected by the shipping worker', () => {
    expect(createHash('sha256').update(fixtureText).digest('hex'))
      .toBe(PERFORMANCE_FIXTURE_SHA256);
    expect(fixture.meta.seed).toBe(PERFORMANCE_FIXTURE_SEED);
    expect(fixture.snapshot.tick + 1).toBe(PERFORMANCE_FIXTURE_POST_ADVANCE_STATE.tick);

    const sim = createCitySim({ seed: fixture.meta.seed, ...CITY_WORKER_SIM_FLAGS });
    sim.world.applySnapshot(
      fixture.snapshot as unknown as Parameters<typeof sim.world.applySnapshot>[0],
    );
    rebuildDerived(sim);
    sim.world.step();
    const summary = simSummary(sim.world);
    const projected = new MovingAgentMessageSync().resetAndSync(
      sim.world,
      sim.topologyVersion,
      () => undefined,
    );

    expect({
      tick: summary.tick,
      populationPeople:
        ((sim.world.getState('population') as number | undefined) ?? 0)
        * PEOPLE_PER_CITIZEN,
      buildingCount: summary.buildings.total,
      vehiclesOnScreen: projected.vehicles.length,
      pedestriansOnScreen: projected.pedestrians.length,
    }).toEqual(PERFORMANCE_FIXTURE_POST_ADVANCE_STATE);
  });

  it('generates candidates with shipping flags without silently replacing the fixture', () => {
    expect(generatorSource).toContain(
      "'output/performance/performance-city-save-candidate.json'",
    );
    expect(generatorSource).toContain("vite.ssrLoadModule('/src/worker/sim-config.ts')");
    expect(generatorSource).toContain('...CITY_WORKER_SIM_FLAGS');
    expect(generatorSource).toContain("args.get('allow-canonical-overwrite') !== 'true'");
    expect(generatorSource).toContain('refusing to overwrite SHA-pinned fixture');
  });
});
