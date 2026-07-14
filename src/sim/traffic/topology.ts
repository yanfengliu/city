import { despawnVehicle } from './vehicles';
import { refreshEdgeCounts } from './congestion';
import { cancelPedestrian } from './pedestrians';
import type { CitySim } from '../city';
import type { CityWorld } from '../types';
import type { RoadEdge, RoadGraph } from '../road/road-graph';

/**
 * Stable identity for an edge across graph rebuilds: endpoints + first path
 * cell + length. An edge whose geometry survives a rebuild keeps its key even
 * though ids are reassigned.
 */
export function edgeKey(edge: RoadEdge): string {
  return `${edge.a}>${edge.b}>${edge.cells[1] ?? -1}>${edge.length}`;
}

export function captureEdgeKeys(graph: RoadGraph): Map<number, string> {
  const keys = new Map<number, string>();
  for (const edge of graph.edges) keys.set(edge.id, edgeKey(edge));
  return keys;
}

/**
 * After a road-graph rebuild, remaps in-flight vehicles' leg edge ids via
 * geometry keys. Vehicles referencing vanished edges despawn (the trip is
 * cancelled and counted in disconnectedTrips). Must run inside a tick
 * (command handler) — it mutates components.
 */
export function remapVehiclesAfterTopologyChange(
  sim: CitySim,
  w: CityWorld,
  oldKeys: Map<number, string>,
): void {
  const newIds = new Map<string, number>();
  for (const edge of sim.roadGraph.edges) newIds.set(edgeKey(edge), edge.id);

  for (const id of [...w.query('vehicle')].sort((a, b) => a - b)) {
    const data = w.getComponent(id, 'vehicle');
    if (!data) continue;
    const newLegs = [];
    let valid = true;
    for (const leg of data.legs) {
      const key = oldKeys.get(leg.edge);
      const newId = key !== undefined ? newIds.get(key) : undefined;
      if (newId === undefined) {
        valid = false;
        break;
      }
      newLegs.push({ edge: newId, reverse: leg.reverse });
    }
    if (valid) {
      w.setComponent(id, 'vehicle', { ...data, legs: newLegs });
    } else {
      const citizenId = data.citizen;
      despawnVehicle(sim, w, id, data);
      w.setState('disconnectedTrips', ((w.getState('disconnectedTrips') as number) ?? 0) + 1);
      const citizen = w.getComponent(citizenId, 'citizen');
      if (citizen) {
        w.patchComponent(citizenId, 'citizen', (c) => {
          c.phase = c.phase === 'toWork' ? 'home' : 'atWork';
          c.waitUntil = w.tick + 128;
        });
      }
    }
  }
  for (const id of [...w.query('pedestrianPath', 'pedestrian')].sort((a, b) => a - b)) {
    const path = w.getComponent(id, 'pedestrianPath');
    const motion = w.getComponent(id, 'pedestrian');
    if (!path || !motion) continue;
    const remaining = path.cells.slice(motion.segmentIndex);
    if (remaining.some((cell) => !sim.roadCells.has(cell))) {
      cancelPedestrian(w, id, path, true);
    }
  }
  refreshEdgeCounts(sim);
}
