import { footprintCells } from '../sim/buildings';
import { createCitySim, getTreasury, rebuildDerived } from '../sim/city';
import { GRID_HEIGHT, GRID_WIDTH } from '../sim/constants/map';
import { SERVICE_FOOTPRINT } from '../sim/constants/services';
import { POWER_PLANT_FOOTPRINT } from '../sim/constants/utilities';
import { DEFAULT_TAX_RATE } from '../sim/constants/zoning';
import { cellIndex } from '../sim/grid';
import type {
  BuildingView,
  ClientToWorker,
  GameSpeed,
  StructureView,
  VehicleView,
  WorkerToClient,
} from '../protocol/messages';
import type {
  BudgetReport,
  BuildingComponent,
  DemandState,
  FieldName,
  StructureComponent,
  TaxRates,
} from '../sim/types';

const workerScope = self as unknown as {
  postMessage(message: WorkerToClient): void;
};

function post(message: WorkerToClient): void {
  workerScope.postMessage(message);
}

// Fields drive desirability; power/water gate buildings. The sim is swappable:
// loadSnapshot builds a fresh one and re-runs the boot sync.
let currentSeed = 12345;
let sim = createCitySim({ seed: currentSeed, fieldsEnabled: true, utilitiesEnabled: true });
let world = sim.world;

let speed: GameSpeed = 1;
let sentTopologyVersion = -1;
let zonesDirty = true;
let trafficDirty = false;
let hadVehicles = false;
let networksDirty = true;
let lastBudget: BudgetReport = { income: 0, expenses: 0 };
const subscribedFields = new Set<FieldName>();
const dirtyFields = new Set<FieldName>();
const knownStructures = new Set<number>();
const EMPLOYED_STAT_INTERVAL = 8;
let cachedEmployed = -1;

function attachWorldListeners(): void {
  world.on('zonesChanged', () => {
    zonesDirty = true;
  });
  world.on('trafficChanged', () => {
    trafficDirty = true;
  });
  world.on('fieldChanged', ({ field }) => {
    dirtyFields.add(field);
  });
  world.on('utilitiesChanged', () => {
    networksDirty = true;
  });
  world.on('budget', (report) => {
    lastBudget = report;
  });
  world.onDiff(onTickDiff);
}

function postField(name: FieldName): void {
  const layer = sim.fields[name];
  const state = layer.getState();
  post({
    type: 'field',
    name,
    blockSize: state.blockSize,
    width: layer.width,
    height: layer.height,
    defaultValue: state.defaultValue,
    cells: state.cells,
  });
}

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

function postNetworksIfChanged(): void {
  if (!networksDirty) return;
  networksDirty = false;
  const plantCells: number[] = [];
  for (const id of [...world.query('powerPlant', 'position')].sort((a, b) => a - b)) {
    const plant = world.getComponent(id, 'powerPlant');
    const position = world.getComponent(id, 'position');
    if (!plant || !position) continue;
    const side = POWER_PLANT_FOOTPRINT[plant.kind];
    plantCells.push(...footprintCells(position.x, position.y, side, side));
  }
  const pumpCells: number[] = [];
  for (const id of [...world.query('waterPump', 'position')].sort((a, b) => a - b)) {
    const position = world.getComponent(id, 'position');
    if (position) pumpCells.push(cellIndex(position.x, position.y));
  }
  post({
    type: 'networks',
    power: {
      plantCells,
      lineCells: [...sim.powerLineCells.keys()].sort((a, b) => a - b),
    },
    water: {
      pumpCells,
      pipeCells: [...sim.pipeCells.keys()].sort((a, b) => a - b),
    },
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
    residents: data.residents,
    jobsFilled: data.jobsFilled,
    powered: data.powered,
    watered: data.watered,
  };
}

/** Posts the full current building/structure sets (boot and post-load sync). */
function postAllEntities(): void {
  const buildings: BuildingView[] = [];
  for (const id of [...world.query('building')].sort((a, b) => a - b)) {
    const data = world.getComponent(id, 'building');
    if (!data) continue;
    const view = buildingView(id, data);
    if (view) buildings.push(view);
  }
  if (buildings.length > 0) post({ type: 'buildings', upserts: buildings, removed: [] });

  knownStructures.clear();
  const structures: StructureView[] = [];
  for (const id of [...world.query('structure', 'position')].sort((a, b) => a - b)) {
    const data = world.getComponent(id, 'structure');
    const position = world.getComponent(id, 'position');
    if (!data || !position) continue;
    knownStructures.add(id);
    structures.push({
      id,
      x: position.x,
      y: position.y,
      w: SERVICE_FOOTPRINT,
      h: SERVICE_FOOTPRINT,
      kind: 'service',
      service: data.type,
    });
  }
  if (structures.length > 0) post({ type: 'structures', upserts: structures, removed: [] });
}

/** Boot handshake: terrain, then every bulk set the renderer mirrors. */
function postBootSync(): void {
  post({
    type: 'ready',
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    seed: currentSeed,
    terrain: {
      width: sim.terrain.width,
      height: sim.terrain.height,
      water: sim.terrain.water,
      trees: sim.terrain.trees,
    },
  });
  sentTopologyVersion = -1;
  zonesDirty = true;
  networksDirty = true;
  hadVehicles = false;
  postRoadsIfChanged();
  postZonesIfChanged();
  postNetworksIfChanged();
  postAllEntities();
  for (const name of subscribedFields) postField(name);
}

// Fires once per executed tick (the engine's GameLoop drives stepping).
const onTickDiff: Parameters<typeof world.onDiff>[0] = (diff) => {
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

  const structureDiff = diff.components['structure'];
  const structureUpserts: StructureView[] = [];
  if (structureDiff) {
    for (const [id, data] of structureDiff.set) {
      const position = world.getComponent(id, 'position');
      if (!position) continue;
      knownStructures.add(id);
      structureUpserts.push({
        id,
        x: position.x,
        y: position.y,
        w: SERVICE_FOOTPRINT,
        h: SERVICE_FOOTPRINT,
        kind: 'service',
        service: (data as StructureComponent).type,
      });
    }
  }
  const structuresRemoved = [...removed].filter((id) => knownStructures.delete(id));
  if (structureUpserts.length > 0 || structuresRemoved.length > 0) {
    post({ type: 'structures', upserts: structureUpserts, removed: structuresRemoved });
  }

  const vehicles: VehicleView[] = [];
  for (const id of world.query('vehicle')) {
    const data = world.getComponent(id, 'vehicle');
    if (!data || data.legIndex >= data.legs.length) continue;
    const leg = data.legs[data.legIndex];
    vehicles.push({ id, edge: leg.edge, t: data.t, reverse: leg.reverse });
  }
  // O(population) scan — refresh on a small cadence, not every tick.
  if (world.tick % EMPLOYED_STAT_INTERVAL === 0 || cachedEmployed < 0) {
    cachedEmployed = 0;
    for (const id of world.query('citizen')) {
      const citizen = world.getComponent(id, 'citizen');
      if (citizen?.work !== null && citizen?.work !== undefined) cachedEmployed++;
    }
  }
  const employed = cachedEmployed;
  if (vehicles.length > 0 || hadVehicles) {
    post({ type: 'vehicles', topologyVersion: sim.topologyVersion, list: vehicles });
  }
  hadVehicles = vehicles.length > 0;

  if (trafficDirty) {
    trafficDirty = false;
    post({
      type: 'traffic',
      edges: [...sim.edgeBuckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, bucket]) => ({ id, bucket })),
    });
  }

  for (const name of dirtyFields) {
    if (subscribedFields.has(name)) postField(name);
  }
  dirtyFields.clear();

  post({
    type: 'frame',
    tick: world.tick,
    speed,
    stats: {
      citizens: (world.getState('population') as number | undefined) ?? 0,
      treasury: getTreasury(world),
      demand: (world.getState('demand') as DemandState | undefined) ?? { r: 0, c: 0, i: 0 },
      vehicles: vehicles.length,
      employed,
      disconnectedTrips: (world.getState('disconnectedTrips') as number | undefined) ?? 0,
      taxRates: (world.getState('taxRates') as TaxRates | undefined) ?? {
        r: DEFAULT_TAX_RATE,
        c: DEFAULT_TAX_RATE,
        i: DEFAULT_TAX_RATE,
      },
      lastBudget,
    },
  });
  postRoadsIfChanged();
  postZonesIfChanged();
  postNetworksIfChanged();
};

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
    case 'setFieldSubscriptions':
      subscribedFields.clear();
      for (const name of message.fields) subscribedFields.add(name);
      // Push immediately so a newly opened overlay fills without waiting for
      // the next recompute.
      for (const name of subscribedFields) postField(name);
      break;
    case 'command': {
      const result = world.submitWithResult(message.name, message.data as never);
      if (!result.accepted) {
        post({ type: 'commandRejected', name: message.name, message: result.message });
      }
      break;
    }
    case 'requestSnapshot':
      post({
        type: 'snapshot',
        snapshot: world.serialize(),
        meta: { saveVersion: 1, seed: currentSeed },
      });
      break;
    case 'loadSnapshot': {
      world.stop();
      currentSeed = message.meta.seed;
      sim = createCitySim({ seed: currentSeed, fieldsEnabled: true, utilitiesEnabled: true });
      world = sim.world;
      world.applySnapshot(message.snapshot as Parameters<typeof world.applySnapshot>[0]);
      rebuildDerived(sim);
      attachWorldListeners();
      postBootSync();
      if (speed === 0) world.pause();
      else world.setSpeed(speed);
      world.start();
      break;
    }
  }
});

attachWorldListeners();
postBootSync();
world.start();
