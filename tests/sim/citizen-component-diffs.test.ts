import type { TickDiff } from 'civ-engine';
import { describe, expect, it } from 'vitest';
import {
  appendCitizenLifeEvent,
  storeCitizenProfile,
  withWorkerRole,
} from '../../src/sim/citizen-profile';
import { moveInSystem } from '../../src/sim/citizens';
import { createCitySim } from '../../src/sim/city';
import type { CitySim } from '../../src/sim/city';
import { findLandBlock, seedBuilding } from './helpers';

function identityTown(): { sim: CitySim; citizen: number } {
  const sim = createCitySim({ seed: 73 });
  const base = findLandBlock(sim, 3, 3);
  seedBuilding(sim, { x: base.x, y: base.y, zone: 'R' });
  sim.world.runMaintenance(() => {
    sim.world.setState('demand', { r: 1, c: 0, i: 0 });
    moveInSystem(sim)(sim.world);
    sim.world.setState('demand', { r: 0, c: 0, i: 0 });
  });
  const citizens = [...sim.world.query('citizen')];
  expect(citizens).toHaveLength(1);
  return { sim, citizen: citizens[0] };
}

describe('citizen rare-component diffs', () => {
  it('keeps nested identity and history out of ordinary hot citizen patches', () => {
    const { sim, citizen } = identityTown();
    sim.world.registerSystem({
      name: 'testHotCitizenDiffIsolation',
      phase: 'update',
      execute: (world) => {
        world.patchComponent(citizen, 'citizen', (data) => {
          data.waitUntil += 1;
          data.happiness = 0.625;
        });
      },
    });

    sim.world.step();
    const diff = sim.world.getDiff() as TickDiff;
    const hot = diff.components.citizen?.set.find(([entity]) => entity === citizen)?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(hot).toBeDefined();
    expect(hot).not.toHaveProperty('profile');
    expect(hot).not.toHaveProperty('lifeEvents');
    expect(diff.components.citizenProfile).toBeUndefined();
    expect(diff.components.citizenLife).toBeUndefined();
  });

  it('writes biography and roster changes only to their rare components', () => {
    const { sim, citizen } = identityTown();
    const profile = sim.world.getComponent(citizen, 'citizenProfile')!;
    let action: 'life' | 'profile' = 'life';
    sim.world.registerSystem({
      name: 'testRareCitizenDiffIsolation',
      phase: 'update',
      execute: (world) => {
        if (action === 'life') {
          appendCitizenLifeEvent(world, citizen, {
            kind: 'stranded',
            memberId: profile.primaryWorkerMemberId,
            activity: 'work',
          });
          return;
        }
        storeCitizenProfile(world, citizen, withWorkerRole(profile, 'I'));
      },
    });

    sim.world.step();
    const lifeDiff = sim.world.getDiff() as TickDiff;
    expect(lifeDiff.components.citizenLife?.set.map(([entity]) => entity)).toContain(citizen);
    expect(lifeDiff.components.citizenProfile).toBeUndefined();
    expect(lifeDiff.components.citizen).toBeUndefined();

    action = 'profile';
    sim.world.step();
    const profileDiff = sim.world.getDiff() as TickDiff;
    expect(profileDiff.components.citizenProfile?.set.map(([entity]) => entity)).toContain(citizen);
    expect(profileDiff.components.citizenLife).toBeUndefined();
    expect(profileDiff.components.citizen).toBeUndefined();
  });
});
