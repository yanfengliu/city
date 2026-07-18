import { describe, expect, it } from 'vitest';
import { createCitySim, type CitySim } from '../../src/sim/city';
import { signalPhase } from '../../src/protocol/signal-phase';
import {
  PEDESTRIAN_MIN_GAP_CELLS,
  VEHICLE_HEADWAY_CELLS,
  VEHICLE_STOP_LINE_CELLS,
} from '../../src/sim/constants/traffic';
import { spawnPedestrian } from '../../src/sim/traffic/pedestrians';
import { spawnVehicle } from '../../src/sim/traffic/trips';
import type { CityWorld, VehicleLeg } from '../../src/sim/types';
import { buildDistrict, findLandBlock } from './helpers';

/** Minimal live citizen whose vehicle/walker survives validity culls. */
function citizenStub(w: CityWorld): { citizen: number; home: number; work: number } {
  let citizen = -1;
  let home = -1;
  let work = -1;
  w.runMaintenance(() => {
    home = w.createEntity();
    work = w.createEntity();
    citizen = w.createEntity();
    w.setPosition(citizen, { x: 0, y: 0 });
    w.addComponent(citizen, 'citizen', {
      home,
      work,
      phase: 'toWork',
      waitUntil: Number.MAX_SAFE_INTEGER,
    });
  });
  return { citizen, home, work };
}

/** Spawns a vehicle mid-edge at an exact progress value. */
function carAt(sim: CitySim, legs: VehicleLeg[], t: number): number {
  const { citizen, work } = citizenStub(sim.world);
  let id = -1;
  sim.world.runMaintenance(() => {
    spawnVehicle(sim, sim.world, citizen, legs, true, work);
    const ids = [...sim.world.query('vehicle')].sort((a, b) => a - b);
    id = ids[ids.length - 1];
    const data = sim.world.getComponent(id, 'vehicle');
    if (!data) throw new Error('vehicle did not spawn');
    sim.world.setComponent(id, 'vehicle', { ...data, t });
  });
  return id;
}

function progressOf(sim: CitySim, id: number): { legIndex: number; t: number } {
  const data = sim.world.getComponent(id, 'vehicle');
  if (!data) throw new Error(`vehicle ${id} despawned`);
  return { legIndex: data.legIndex, t: data.t };
}

describe('vehicle headway', () => {
  it('a follower may never sit closer than the headway gap once flow settles', () => {
    const sim = createCitySim({ seed: 11 });
    const base = findLandBlock(sim, 24, 6);
    const y = base.y + 2;
    expect(
      sim.world.submit('placeRoad', { ax: base.x, ay: y, bx: base.x + 20, by: y }),
    ).toBe(true);
    sim.world.step();
    const edge = sim.roadGraph.edges.find((e) => e.length >= 20);
    if (!edge) throw new Error('no long edge for the headway scenario');

    const headwayT = VEHICLE_HEADWAY_CELLS / edge.length;
    const legs: VehicleLeg[] = [{ edge: edge.id, reverse: false }];
    const leader = carAt(sim, legs, 0.5);
    const follower = carAt(sim, legs, 0.5 - headwayT * 0.3);

    // One settle tick lets the follower drop back to the enforced gap.
    sim.world.step();
    for (let i = 0; i < 8; i++) {
      sim.world.step();
      const lead = progressOf(sim, leader);
      const chase = progressOf(sim, follower);
      expect(lead.legIndex).toBe(0);
      expect(chase.legIndex).toBe(0);
      expect(lead.t).toBeGreaterThan(chase.t);
      expect(lead.t - chase.t).toBeGreaterThanOrEqual(headwayT - 1e-9);
    }
  });

  it('same-direction cars never overlap anywhere across a whole commuting scenario', { timeout: 120_000 }, () => {
    const sim = createCitySim({ seed: 7 });
    const base = findLandBlock(sim, 18, 26);
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'R', { x: base.x, y: base.y + 5 });
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 16 });
    const corridorX = base.x + 8;
    expect(
      sim.world.submit('placeRoad', {
        ax: corridorX,
        ay: base.y + 2,
        bx: corridorX,
        by: base.y + 18,
      }),
    ).toBe(true);
    sim.world.step();

    let crowdedTicks = 0;
    for (let i = 0; i < 2600; i++) {
      sim.world.step();
      const byLane = new Map<string, number[]>();
      for (const id of sim.world.query('vehicle')) {
        const data = sim.world.getComponent(id, 'vehicle');
        if (!data) continue;
        const leg = data.legs[data.legIndex];
        const key = `${leg.edge}:${leg.reverse ? 1 : 0}`;
        const list = byLane.get(key);
        if (list) list.push(data.t);
        else byLane.set(key, [data.t]);
      }
      for (const [key, ts] of byLane) {
        if (ts.length < 2) continue;
        crowdedTicks++;
        ts.sort((a, b) => a - b);
        const edgeId = Number(key.split(':')[0]);
        const length = sim.roadGraph.edges[edgeId].length;
        const headwayT = VEHICLE_HEADWAY_CELLS / length;
        for (let n = 0; n + 1 < ts.length; n++) {
          expect(ts[n + 1] - ts[n]).toBeGreaterThanOrEqual(headwayT - 1e-9);
        }
      }
    }
    // The invariant must have been exercised, not vacuously true.
    expect(crowdedTicks).toBeGreaterThan(50);
  });
});

describe('junction signals', () => {
  it('holds cars at the stop line on red and releases them on green', { timeout: 60_000 }, () => {
    const sim = createCitySim({ seed: 11 });
    const base = findLandBlock(sim, 20, 20);
    const cx = base.x + 9;
    const cy = base.y + 10;
    expect(
      sim.world.submit('placeRoad', { ax: base.x, ay: cy, bx: base.x + 18, by: cy }),
    ).toBe(true);
    sim.world.step();
    expect(
      sim.world.submit('placeRoad', { ax: cx, ay: base.y + 2, bx: cx, by: base.y + 18 }),
    ).toBe(true);
    sim.world.step();

    const node = cy * sim.terrain.width + cx;
    const incident = sim.roadGraph.nodes.get(node) ?? [];
    expect(incident.length).toBeGreaterThanOrEqual(3);

    // South approach: the edge linking the junction to the road end below it.
    const south = (base.y + 18) * sim.terrain.width + cx;
    const approach = sim.roadGraph.edges.find(
      (e) => (e.a === node && e.b === south) || (e.a === south && e.b === node),
    );
    const westEnd = cy * sim.terrain.width + base.x;
    const exit = sim.roadGraph.edges.find(
      (e) => (e.a === node && e.b === westEnd) || (e.a === westEnd && e.b === node),
    );
    if (!approach || !exit) throw new Error('junction edges not found');

    const legs: VehicleLeg[] = [
      { edge: approach.id, reverse: approach.a === node },
      { edge: exit.id, reverse: exit.b === node },
    ];

    // Step to the start of a window where the north-south approach is red
    // for at least 24 ticks, then spawn the car three cells from the line.
    const nsRedAt = (tick: number): boolean => signalPhase(tick, node) !== 'ns';
    let guard = 0;
    while (guard++ < 1000) {
      let longRed = true;
      for (let ahead = 1; ahead <= 24; ahead++) {
        if (!nsRedAt(sim.world.tick + ahead)) {
          longRed = false;
          break;
        }
      }
      if (longRed) break;
      sim.world.step();
    }
    const car = carAt(sim, legs, 1 - 3 / approach.length);

    const stopT = 1 - VEHICLE_STOP_LINE_CELLS / approach.length;
    for (let i = 0; i < 24; i++) {
      sim.world.step();
      const at = progressOf(sim, car);
      expect(at.legIndex).toBe(0);
      expect(at.t).toBeLessThanOrEqual(stopT + 1e-9);
    }

    // Green must eventually release the queue through the junction.
    let crossed = false;
    for (let i = 0; i < 400 && !crossed; i++) {
      sim.world.step();
      const data = sim.world.getComponent(car, 'vehicle');
      if (!data || data.legIndex > 0) crossed = true;
    }
    expect(crossed).toBe(true);
  });
});

describe('pedestrian spacing', () => {
  it('same-lane walkers keep their personal-space gap', () => {
    const sim = createCitySim({ seed: 11 });
    const base = findLandBlock(sim, 14, 6);
    const y = base.y + 2;
    expect(
      sim.world.submit('placeRoad', { ax: base.x, ay: y, bx: base.x + 10, by: y }),
    ).toBe(true);
    sim.world.step();
    const cells = Array.from({ length: 11 }, (_, i) => y * sim.terrain.width + base.x + i);

    const spawnWalker = (t: number): number => {
      const { citizen, work } = citizenStub(sim.world);
      let id = -1;
      sim.world.runMaintenance(() => {
        id = spawnPedestrian(sim.world, citizen, cells, work, 'shopping', true);
        sim.world.setComponent(id, 'pedestrian', { segmentIndex: 3, t });
      });
      return id;
    };
    const leader = spawnWalker(0.5);
    const follower = spawnWalker(0.5 - PEDESTRIAN_MIN_GAP_CELLS * 0.3);

    // Settle: the follower holds while the leader opens the gap at walking
    // speed, which takes ceil(gapDeficit / speed) = 3 ticks here.
    for (let settle = 0; settle < 3; settle++) sim.world.step();
    for (let i = 0; i < 4; i++) {
      sim.world.step();
      const lead = sim.world.getComponent(leader, 'pedestrian');
      const chase = sim.world.getComponent(follower, 'pedestrian');
      if (!lead || !chase) throw new Error('walker despawned');
      const gap =
        lead.segmentIndex + lead.t - (chase.segmentIndex + chase.t);
      expect(gap).toBeGreaterThanOrEqual(PEDESTRIAN_MIN_GAP_CELLS - 1e-9);
    }
  });
});
