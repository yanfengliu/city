import { createCitySim, getTreasury } from '../sim/city';
import { GRID_HEIGHT, GRID_WIDTH } from '../sim/constants/map';
import type {
  BuildingView,
  ClientToWorker,
  GameSpeed,
  WorkerToClient,
} from '../protocol/messages';
import type { BuildingComponent, DemandState } from '../sim/types';

const workerScope = self as unknown as {
  postMessage(message: WorkerToClient): void;
};

function post(message: WorkerToClient): void {
  workerScope.postMessage(message);
}

const seed = 12345;
const sim = createCitySim({ seed });
const { world } = sim;

let speed: GameSpeed = 1;
let sentTopologyVersion = -1;
let zonesDirty = true;

world.on('zonesChanged', () => {
  zonesDirty = true;
});

function postRoadsIfChanged(): void {
  if (sim.topologyVersion === sentTopologyVersion) return;
  sentTopologyVersion = sim.topologyVersion;
  post({
    type: 'roads',
    topologyVersion: sim.topologyVersion,
    cells: [...sim.roadCells].sort((a, b) => a - b),
    edges: sim.roadGraph.edges.map((e) => ({ id: e.id, a: e.a, b: e.b, cells: e.cells })),
  });
}

function postZonesIfChanged(): void {
  if (!zonesDirty) return;
  zonesDirty = false;
  post({
    type: 'zones',
    cells: [...sim.zoneCells.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, zone]) => ({ i, zone })),
  });
}

function buildingView(id: number, data: BuildingComponent): BuildingView | null {
  const position = world.getComponent(id, 'position');
  if (!position) return null;
  return {
    id,
    x: position.x,
    y: position.y,
    w: data.w,
    h: data.h,
    kind: 'rci',
    zone: data.zone,
    level: data.level,
    abandoned: data.abandoned,
  };
}

// Fires once per executed tick (the engine's GameLoop drives stepping).
world.onDiff((diff) => {
  const buildingDiff = diff.components['building'];
  const upserts: BuildingView[] = [];
  if (buildingDiff) {
    for (const [id, data] of buildingDiff.set) {
      const view = buildingView(id, data as BuildingComponent);
      if (view) upserts.push(view);
    }
  }
  const removed = diff.entities.destroyed;
  if (upserts.length > 0 || removed.length > 0) {
    post({ type: 'buildings', upserts, removed: [...removed] });
  }

  post({
    type: 'frame',
    tick: world.tick,
    speed,
    stats: {
      citizens: (world.getState('population') as number | undefined) ?? 0,
      treasury: getTreasury(world),
      demand: (world.getState('demand') as DemandState | undefined) ?? { r: 0, c: 0, i: 0 },
    },
  });
  postRoadsIfChanged();
  postZonesIfChanged();
});

addEventListener('message', (event) => {
  const message = (event as MessageEvent<ClientToWorker>).data;
  switch (message.type) {
    case 'setSpeed':
      speed = message.speed;
      // speed 0 must never reach setSpeed (the engine throws on non-positive).
      if (message.speed === 0) {
        world.pause();
      } else {
        world.setSpeed(message.speed);
        world.resume();
      }
      break;
    case 'advance':
      for (let i = 0; i < message.ticks; i++) world.step();
      break;
    case 'command': {
      const result = world.submitWithResult(message.name, message.data as never);
      if (!result.accepted) {
        post({ type: 'commandRejected', name: message.name, message: result.message });
      }
      break;
    }
  }
});

post({
  type: 'ready',
  gridWidth: GRID_WIDTH,
  gridHeight: GRID_HEIGHT,
  seed,
  terrain: {
    width: sim.terrain.width,
    height: sim.terrain.height,
    water: sim.terrain.water,
    trees: sim.terrain.trees,
  },
});
postRoadsIfChanged();
postZonesIfChanged();
world.start();
