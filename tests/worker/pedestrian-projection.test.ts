import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import type { WorkerToClient } from '../../src/protocol/messages';
import {
  MovingAgentMessageSync,
  projectPedestrians,
} from '../../src/worker/pedestrian-projection';

function addWalker(sim: ReturnType<typeof createCitySim>): number {
  let walker = -1;
  sim.world.runMaintenance(() => {
    const citizen = sim.world.createEntity();
    const destination = sim.world.createEntity();
    walker = sim.world.createEntity();
    sim.world.setPosition(walker, { x: 1, y: 0 });
    sim.world.addComponent(walker, 'pedestrianPath', {
      citizen,
      citizenGen: sim.world.getEntityGeneration(citizen),
      cells: [1, 2, 3],
      destination,
      destinationGen: sim.world.getEntityGeneration(destination),
      purpose: 'commercial-work',
      outbound: true,
    });
    sim.world.addComponent(walker, 'pedestrian', { segmentIndex: 0, t: 0.4 });
  });
  return walker;
}

describe('pedestrian worker projection', () => {
  it('sends only the current exact-cell segment with identity and purpose', () => {
    const sim = createCitySim({ seed: 7 });
    let citizen = -1;
    let destination = -1;
    let walker = -1;
    sim.world.runMaintenance(() => {
      citizen = sim.world.createEntity();
      destination = sim.world.createEntity();
      walker = sim.world.createEntity();
      sim.world.setPosition(walker, { x: 2, y: 0 });
      sim.world.addComponent(walker, 'pedestrianPath', {
        citizen,
        citizenGen: sim.world.getEntityGeneration(citizen),
        cells: [1, 2, 3, 4],
        destination,
        destinationGen: sim.world.getEntityGeneration(destination),
        purpose: 'shopping',
        outbound: true,
      });
      sim.world.addComponent(walker, 'pedestrian', { segmentIndex: 2, t: 1.4 });
    });

    expect(projectPedestrians(sim.world)).toEqual([
      {
        id: walker,
        generation: sim.world.getEntityGeneration(walker),
        citizen,
        fromCell: 3,
        toCell: 4,
        t: 0.999,
        purpose: 'shopping',
        outbound: true,
      },
    ]);
  });

  it('carries the owning citizen so a clicked walker maps back to a person', () => {
    const sim = createCitySim({ seed: 7 });
    const walker = addWalker(sim);
    const path = sim.world.getComponent(walker, 'pedestrianPath');
    if (!path) throw new Error(`walker ${walker} has no path component`);

    const [view] = projectPedestrians(sim.world);
    expect(view.citizen).toBe(path.citizen);
  });

  it('returns an empty full-list payload when no walkers are active', () => {
    const sim = createCitySim({ seed: 7 });
    expect(projectPedestrians(sim.world)).toEqual([]);
  });

  it('boot-syncs walkers that already exist in a restored paused world', () => {
    const sim = createCitySim({ seed: 7 });
    const walker = addWalker(sim);
    const messages: WorkerToClient[] = [];
    const sync = new MovingAgentMessageSync();

    const frame = sync.resetAndSync(
      sim.world,
      sim.topologyVersion,
      (message) => messages.push(message),
    );

    expect(frame.pedestrians).toEqual(projectPedestrians(sim.world));
    expect(frame.pedestrians[0]?.id).toBe(walker);
    expect(messages.filter((message) => message.type === 'pedestrians')).toEqual([
      { type: 'pedestrians', list: frame.pedestrians },
    ]);
  });

  it('sends one empty full list after the last walker disappears', () => {
    const sim = createCitySim({ seed: 7 });
    const walker = addWalker(sim);
    const messages: WorkerToClient[] = [];
    const sync = new MovingAgentMessageSync();
    sync.resetAndSync(sim.world, sim.topologyVersion, (message) => messages.push(message));
    messages.length = 0;

    sim.world.runMaintenance(() => sim.world.destroyEntity(walker));
    sync.sync(sim.world, sim.topologyVersion, (message) => messages.push(message));
    expect(messages.filter((message) => message.type === 'pedestrians')).toEqual([
      { type: 'pedestrians', list: [] },
    ]);

    messages.length = 0;
    sync.sync(sim.world, sim.topologyVersion, (message) => messages.push(message));
    expect(messages.filter((message) => message.type === 'pedestrians')).toEqual([]);
  });
});
