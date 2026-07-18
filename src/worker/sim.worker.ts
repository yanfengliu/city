import { MemorySink, SessionRecorder, snapshotAtTick, type SessionBundle } from 'civ-engine';
import { footprintCells } from '../sim/buildings';
import { createCitySim, getTreasury, rebuildDerived, type CitySimConfig } from '../sim/city';
import { cityFindingToMarker, findingsFromMarkers } from '../harness/findings';
import { selfCheckBundle } from '../harness/inspect';
import { simSummary } from '../sim/summary';
import { GRID_HEIGHT, GRID_WIDTH } from '../sim/constants/map';
import { SERVICE_FOOTPRINT } from '../sim/constants/services';
import { POWER_PLANT_FOOTPRINT } from '../sim/constants/utilities';
import { utilityTotals } from '../sim/utilities';
import { DEFAULT_TAX_RATE } from '../sim/constants/zoning';
import { cellIndex } from '../sim/grid';
import { projectRenderComponentRemovals } from './diff-projection';
import { MovingAgentMessageSync } from './pedestrian-projection';
import type {
  BuildingView,
  ClientToWorker,
  GameSpeed,
  StructureView,
  WorkerToClient,
} from '../protocol/messages';
import type {
  BudgetReport,
  BuildingComponent,
  CityCommands,
  CityEvents,
  DemandState,
  FieldName,
  StructureComponent,
  TaxRates,
} from '../sim/types';

const workerScope = self as unknown as {
  name: string;
  postMessage(message: WorkerToClient): void;
};

function post(message: WorkerToClient): void {
  workerScope.postMessage(message);
}

// Fields drive desirability; power/water gate buildings. The sim is swappable:
// loadSnapshot builds a fresh one and re-runs the boot sync.
const SIM_FLAGS: Omit<CitySimConfig, 'seed'> = {
  fieldsEnabled: true,
  utilitiesEnabled: true,
  highwayEnabled: true,
};
let currentSeed = 12345;
let sim = createCitySim({ seed: currentSeed, ...SIM_FLAGS });
let world = sim.world;

// Opt-in playtest harness (docs/harness.md): a recorder-named dev worker treats
// every world as one session so commands/ticks/markers replay deterministically.
function makeRecorder(w: typeof world): SessionRecorder<CityEvents, CityCommands> {
  return new SessionRecorder({ world: w, sink: new MemorySink() }) as SessionRecorder<
    CityEvents,
    CityCommands
  >;
}
let recorder: ReturnType<typeof makeRecorder> | undefined;
function startRecorder(): void {
  // Recording is a dev/playtest tool: it accumulates every tick's diff, so it
  // is opt-in on localhost and off in production builds.
  if (import.meta.env.DEV && workerScope.name === 'city-playtest-recorder') {
    recorder = makeRecorder(world);
    recorder.connect();
  }
}
function recordedBundle(): SessionBundle<CityEvents, CityCommands> {
  return recorder!.toBundle() as unknown as SessionBundle<CityEvents, CityCommands>;
}

/** Rebuild the world from a snapshot and start a fresh recording session (used
 * by loadSnapshot and the harness replayTo). */
function swapWorld(snapshot: Parameters<typeof world.applySnapshot>[0], seed: number): void {
  recorder?.disconnect();
  world.stop();
  currentSeed = seed;
  sim = createCitySim({ seed: currentSeed, ...SIM_FLAGS });
  world = sim.world;
  world.applySnapshot(snapshot);
  rebuildDerived(sim);
  // A loaded city is a different world — drop the per-interval stat caches so
  // the HUD shows its numbers (employment, utility totals) on the first frame,
  // not the previous city's until the next 8-tick recompute.
  cachedEmployed = -1;
  cachedUtilityTotals = { power: { supply: 0, demand: 0 }, water: { supply: 0, demand: 0 } };
  lastBudget = { income: 0, expenses: 0, retailIncome: 0 };
  attachWorldListeners();
  startRecorder();
  postBootSync();
  if (speed === 0) world.pause();
  else world.setSpeed(speed);
  world.start();
}

let speed: GameSpeed = 1;
let sentTopologyVersion = -1;
let zonesDirty = true;
let trafficDirty = false;
let networksDirty = true;
let lastBudget: BudgetReport = { income: 0, expenses: 0, retailIncome: 0 };
const movingAgentMessages = new MovingAgentMessageSync();
const subscribedFields = new Set<FieldName>();
const dirtyFields = new Set<FieldName>();
const knownStructures = new Set<number>();
const EMPLOYED_STAT_INTERVAL = 8;
let cachedEmployed = -1;
let cachedUtilityTotals: ReturnType<typeof utilityTotals> = {
  power: { supply: 0, demand: 0 },
  water: { supply: 0, demand: 0 },
};

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
  const plants: Array<{
    kind: 'coal' | 'wind';
    x: number;
    y: number;
    w: number;
    h: number;
    cells: number[];
  }> = [];
  for (const id of [...world.query('powerPlant', 'position')].sort((a, b) => a - b)) {
    const plant = world.getComponent(id, 'powerPlant');
    const position = world.getComponent(id, 'position');
    if (!plant || !position) continue;
    const side = POWER_PLANT_FOOTPRINT[plant.kind];
    const cells = footprintCells(position.x, position.y, side, side);
    plantCells.push(...cells);
    plants.push({
      kind: plant.kind,
      x: position.x,
      y: position.y,
      w: side,
      h: side,
      cells,
    });
  }
  const pumpCells: number[] = [];
  for (const id of [...world.query('waterPump', 'position')].sort((a, b) => a - b)) {
    const position = world.getComponent(id, 'position');
    if (position) pumpCells.push(cellIndex(position.x, position.y));
  }
  post({
    type: 'networks',
    power: {
      plants,
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
      elevation: sim.terrain.elevation,
      seaLevel: sim.terrain.seaLevel,
      water: sim.terrain.water,
      trees: sim.terrain.trees,
    },
  });
  sentTopologyVersion = -1;
  zonesDirty = true;
  networksDirty = true;
  movingAgentMessages.resetAndSync(world, sim.topologyVersion, post);
  postRoadsIfChanged();
  postZonesIfChanged();
  postNetworksIfChanged();
  postAllEntities();
  for (const name of subscribedFields) postField(name);
}

// Fires once per executed tick (the engine's GameLoop drives stepping).
const onTickDiff: Parameters<typeof world.onDiff>[0] = (diff) => {
  const componentRemovals = projectRenderComponentRemovals(diff);
  const buildingDiff = diff.components['building'];
  const upserts: BuildingView[] = [];
  if (buildingDiff) {
    for (const [id, data] of buildingDiff.set) {
      const view = buildingView(id, data as BuildingComponent);
      if (view) upserts.push(view);
    }
  }
  const removed = componentRemovals.buildings;
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
  const structuresRemoved = componentRemovals.structures.filter((id) =>
    knownStructures.delete(id),
  );
  if (structureUpserts.length > 0 || structuresRemoved.length > 0) {
    post({ type: 'structures', upserts: structureUpserts, removed: structuresRemoved });
  }

  const movingAgents = movingAgentMessages.sync(world, sim.topologyVersion, post);
  const { vehicles, pedestrians } = movingAgents;
  // O(population)/O(buildings) scans — refresh on a small cadence, not every tick.
  if (world.tick % EMPLOYED_STAT_INTERVAL === 0 || cachedEmployed < 0) {
    cachedEmployed = 0;
    for (const id of world.query('citizen')) {
      const citizen = world.getComponent(id, 'citizen');
      if (citizen?.work !== null && citizen?.work !== undefined) cachedEmployed++;
    }
    cachedUtilityTotals = utilityTotals(world);
  }
  const employed = cachedEmployed;
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
      pedestrians: pedestrians.length,
      employed,
      completedShoppingTrips:
        (world.getState('completedShoppingTrips') as number | undefined) ?? 0,
      disconnectedTrips: (world.getState('disconnectedTrips') as number | undefined) ?? 0,
      taxRates: (world.getState('taxRates') as TaxRates | undefined) ?? {
        r: DEFAULT_TAX_RATE,
        c: DEFAULT_TAX_RATE,
        i: DEFAULT_TAX_RATE,
      },
      lastBudget,
      power: cachedUtilityTotals.power,
      water: cachedUtilityTotals.water,
    },
  });
  postRoadsIfChanged();
  postZonesIfChanged();
  postNetworksIfChanged();
};

/**
 * Fast-forward in batches so queued commands still interleave — one giant
 * synchronous loop starved the worker's event loop for seconds (automation
 * hook, but batching also matters if a future UI fast-forward uses it).
 */
const ADVANCE_BATCH_TICKS = 100;
function advanceInBatches(remaining: number): void {
  const batch = Math.min(remaining, ADVANCE_BATCH_TICKS);
  for (let i = 0; i < batch; i++) world.step();
  if (remaining > batch) setTimeout(() => advanceInBatches(remaining - batch), 0);
}

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
      advanceInBatches(message.ticks);
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
      post({
        type: 'commandSubmissionResult', id: message.id ?? 0, name: message.name,
        // Prefer the game's specific reason over the engine's generic
        // "Validation failed" (AGENTS.md: error messages are a product surface).
        accepted: result.accepted,
        message: result.accepted ? result.message : sim.lastRejection ?? result.message,
        tick: world.tick,
      });
      break;
    }
    case 'requestSnapshot':
      post({
        type: 'snapshot',
        snapshot: world.serialize(),
        meta: { saveVersion: 1, seed: currentSeed },
      });
      break;
    case 'loadSnapshot':
      swapWorld(message.snapshot as Parameters<typeof world.applySnapshot>[0], message.meta.seed);
      break;
    case 'annotate': {
      if (!recorder) break;
      const tick = world.tick;
      recorder.addMarker(cityFindingToMarker(message.finding, tick));
      post({ type: 'annotated', tick, finding: message.finding });
      break;
    }
    case 'requestBundle': {
      if (!recorder) break;
      const bundle = recordedBundle();
      post({ type: 'bundle', id: message.id, bundle, findings: findingsFromMarkers(bundle.markers) });
      break;
    }
    case 'inspectAt': {
      if (!recorder) break;
      // Clamp to the recorded range so a stale/out-of-range tick never throws,
      // then fold to it in a throwaway probe sim (the live world is untouched).
      // Always replies (null + error on failure) so the client Promise settles.
      try {
        const bundle = recordedBundle();
        const start = bundle.metadata.startTick ?? 0;
        const end = bundle.metadata.endTick ?? start;
        const tick = Math.max(start, Math.min(end, message.tick));
        const snap = snapshotAtTick(bundle, tick);
        const probe = createCitySim({ seed: currentSeed, ...SIM_FLAGS });
        probe.world.applySnapshot(snap as Parameters<typeof probe.world.applySnapshot>[0]);
        rebuildDerived(probe);
        post({ type: 'inspection', id: message.id, tick, summary: simSummary(probe.world) });
      } catch (e) {
        post({ type: 'inspection', id: message.id, tick: message.tick, summary: null, error: String(e) });
      }
      break;
    }
    case 'selfCheck': {
      if (!recorder) break;
      try {
        // A connected recorder has only the initial + periodic snapshots, so
        // selfCheck (which walks snapshot PAIRS) would skip every tick after the
        // last one. Take a terminal snapshot to close the final segment.
        recorder.takeSnapshot();
        const result = selfCheckBundle(recordedBundle(), { seed: currentSeed, ...SIM_FLAGS });
        post({ type: 'selfCheckResult', id: message.id, result });
      } catch (e) {
        post({ type: 'selfCheckResult', id: message.id, result: null, error: String(e) });
      }
      break;
    }
  }
});

attachWorldListeners();
startRecorder();
postBootSync();
world.start();
