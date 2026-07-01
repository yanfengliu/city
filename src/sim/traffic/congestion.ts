import { BUCKET_THRESHOLDS, EDGE_CAPACITY_PER_CELL } from '../constants/traffic';
import type { CitySim } from '../city';
import type { CityWorld } from '../types';

export function bucketFor(count: number, edgeLength: number): number {
  const congestion = count / (edgeLength * EDGE_CAPACITY_PER_CELL);
  let bucket = 0;
  for (const threshold of BUCKET_THRESHOLDS) {
    if (congestion >= threshold) bucket++;
  }
  return bucket;
}

/**
 * Requantizes per-edge congestion buckets. When any bucket changes, the path
 * version bumps so NEW paths see updated costs (in-flight vehicles keep their
 * routes) and the worker pushes a traffic-overlay update.
 */
export function congestionSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    let changed = false;
    const next = new Map<number, number>();
    for (const edge of sim.roadGraph.edges) {
      const bucket = bucketFor(sim.edgeCounts.get(edge.id) ?? 0, edge.length);
      if (bucket > 0) next.set(edge.id, bucket);
      if ((sim.edgeBuckets.get(edge.id) ?? 0) !== bucket) changed = true;
    }
    if (sim.edgeBuckets.size !== next.size) changed = true;
    if (!changed) return;
    sim.edgeBuckets = next;
    sim.pathVersion += 1;
    writeCongestionMirror(sim, w);
    w.emit('trafficChanged', {});
  };
}

/** Persists the bucket map so vehicle speeds replay identically after load. */
export function writeCongestionMirror(sim: CitySim, w: CityWorld): void {
  const mirror = w.getState('mirrorEntity') as number;
  w.setComponent(mirror, 'congestionMirror', {
    buckets: [...sim.edgeBuckets.entries()].sort(([a], [b]) => a - b),
  });
}

/** Restores buckets from the mirror entity after snapshot load. */
export function readCongestionMirror(sim: CitySim): void {
  const mirror = sim.world.getState('mirrorEntity') as number | undefined;
  const data = mirror !== undefined ? sim.world.getComponent(mirror, 'congestionMirror') : undefined;
  sim.edgeBuckets = new Map(data?.buckets ?? []);
}

/** Rebuilds per-edge vehicle counts from vehicle components (post-load/remap). */
export function refreshEdgeCounts(sim: CitySim): void {
  const counts = new Map<number, number>();
  for (const id of sim.world.query('vehicle')) {
    const data = sim.world.getComponent(id, 'vehicle');
    if (!data || data.legIndex >= data.legs.length) continue;
    const edge = data.legs[data.legIndex].edge;
    counts.set(edge, (counts.get(edge) ?? 0) + 1);
  }
  sim.edgeCounts = counts;
}
