import type {
  PedestrianView,
  VehicleView,
  WorkerToClient,
} from '../protocol/messages';
import type { CityWorld } from '../sim/types';

type MovingAgentMessage = Extract<
  WorkerToClient,
  { type: 'vehicles' | 'pedestrians' }
>;

export interface MovingAgentFrame {
  vehicles: VehicleView[];
  pedestrians: PedestrianView[];
}

type PostMovingAgentMessage = (message: MovingAgentMessage) => void;

function projectVehicles(world: CityWorld): VehicleView[] {
  const vehicles: VehicleView[] = [];
  for (const id of world.query('vehicle')) {
    const data = world.getComponent(id, 'vehicle');
    if (!data || data.legIndex >= data.legs.length) continue;
    const leg = data.legs[data.legIndex];
    vehicles.push({
      id,
      generation: world.getEntityGeneration(id),
      edge: leg.edge,
      t: data.t,
      reverse: leg.reverse,
    });
  }
  return vehicles;
}

/** Projects only each walker's current segment; complete paths stay worker-local. */
export function projectPedestrians(world: CityWorld): PedestrianView[] {
  const pedestrians: PedestrianView[] = [];
  for (const id of [...world.query('pedestrianPath', 'pedestrian')].sort((a, b) => a - b)) {
    const path = world.getComponent(id, 'pedestrianPath');
    const motion = world.getComponent(id, 'pedestrian');
    if (!path || !motion || path.cells.length === 0) continue;
    const fromCell = path.cells[Math.min(motion.segmentIndex, path.cells.length - 1)];
    const toCell = path.cells[Math.min(motion.segmentIndex + 1, path.cells.length - 1)];
    pedestrians.push({
      id,
      generation: world.getEntityGeneration(id),
      fromCell,
      toCell,
      t: Math.min(motion.t, 0.999),
      purpose: path.purpose,
      outbound: path.outbound,
    });
  }
  return pedestrians;
}

/**
 * Owns full-list message gating for moving presentation agents. A boot reset
 * always projects the current world instead of assuming it is empty, which is
 * required when a restored snapshot remains paused and executes no next tick.
 */
export class MovingAgentMessageSync {
  private hadVehicles = false;
  private hadPedestrians = false;

  resetAndSync(
    world: CityWorld,
    topologyVersion: number,
    post: PostMovingAgentMessage,
  ): MovingAgentFrame {
    this.hadVehicles = false;
    this.hadPedestrians = false;
    return this.projectAndSync(world, topologyVersion, post, true);
  }

  sync(
    world: CityWorld,
    topologyVersion: number,
    post: PostMovingAgentMessage,
  ): MovingAgentFrame {
    return this.projectAndSync(world, topologyVersion, post, false);
  }

  private projectAndSync(
    world: CityWorld,
    topologyVersion: number,
    post: PostMovingAgentMessage,
    force: boolean,
  ): MovingAgentFrame {
    const vehicles = projectVehicles(world);
    const pedestrians = projectPedestrians(world);
    if (force || vehicles.length > 0 || this.hadVehicles) {
      post({ type: 'vehicles', topologyVersion, list: vehicles });
    }
    if (force || pedestrians.length > 0 || this.hadPedestrians) {
      post({ type: 'pedestrians', list: pedestrians });
    }
    this.hadVehicles = vehicles.length > 0;
    this.hadPedestrians = pedestrians.length > 0;
    return { vehicles, pedestrians };
  }
}
