import { BuildingsView } from '../rendering/buildings-mesh';
import { ZONE_COLORS } from '../rendering/constants';
import { CityScene } from '../rendering/scene';
import { GhostView } from '../rendering/ghost';
import { FieldOverlayView, TrafficOverlayView } from '../rendering/overlay';
import { NetworksView } from '../rendering/networks-mesh';
import { NetworkOverlayView } from '../rendering/network-overlay';
import { GroundPicker } from '../rendering/picking';
import { RadiusIndicator } from '../rendering/radius-indicator';
import { LevelUpFx } from '../rendering/levelup-fx';
import { RoadsView } from '../rendering/roads-mesh';
import { StructuresView } from '../rendering/structures-mesh';
import { buildTerrainMesh } from '../rendering/terrain-mesh';
import { TreesView } from '../rendering/trees';
import { VehiclesView } from '../rendering/vehicles-mesh';
import { ZonesView } from '../rendering/zones-mesh';
import { Hud, type OverlayName } from '../ui/hud';
import { BudgetPanel } from '../ui/budget-panel';
import { InspectPanel } from '../ui/inspect-panel';
import { AdvisorPanel, type Advisory } from '../ui/advisor';
import { GRID_HEIGHT, GRID_WIDTH, TICKS_PER_DAY, TICK_MS } from '../sim/constants/map';
import { SERVICE_RADIUS } from '../sim/constants/services';
import { UTILITY_BRIDGE_RADIUS } from '../sim/constants/utilities';
import { CAPACITY_PER_CELL, PEOPLE_PER_CITIZEN } from '../sim/constants/zoning';
import { cellIndex, type Cell } from '../sim/grid';
import {
  consumePendingLoad,
  hasSave,
  readSave,
  requestLoadOnNextBoot,
  writeSave,
} from '../persistence/save';
import { attachInput } from './input';
import { TOOL_GROUPS, Tools, type ToolName } from './tools';
import type {
  BuildingView,
  ClientToWorker,
  GameSpeed,
  StructureView,
  TerrainPayload,
  WorkerToClient,
} from '../protocol/messages';
import type {
  BudgetReport,
  DemandState,
  FieldName,
  ServiceType,
  TaxRates,
  ZoneType,
} from '../sim/types';
import { DEFAULT_TAX_RATE } from '../sim/constants/zoning';

const HUD_REFRESH_MS = 250;
const ZONE_LABELS: Record<ZoneType, string> = {
  R: 'Residential',
  C: 'Commercial',
  I: 'Industrial',
};
const SERVICE_LABELS: Record<ServiceType, string> = {
  fireStation: 'Fire Station',
  police: 'Police Station',
  clinic: 'Clinic',
  school: 'School',
};
const FIELD_OVERLAYS: readonly OverlayName[] = ['pollution', 'noise', 'landValue'];

/** A clicked map object: a grown RCI building or a player-placed service structure. */
type Inspected = { kind: 'building' | 'structure'; id: number };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Composition root: wires the sim worker, renderer, tools, and HUD together. */
export class Game {
  private readonly worker: Worker;
  private readonly scene: CityScene;
  private readonly hud: Hud<ToolName>;
  private readonly tools: Tools;
  private readonly ghost: GhostView;
  private readonly roadsView: RoadsView;
  private readonly zonesView: ZonesView;
  private readonly buildingsView: BuildingsView;
  private readonly vehiclesView: VehiclesView;
  private readonly structuresView: StructuresView;
  private readonly fieldOverlay: FieldOverlayView;
  private readonly trafficOverlay: TrafficOverlayView;
  private readonly networksView: NetworksView;
  private readonly radiusIndicator = new RadiusIndicator();
  /** Coverage square shown while a service building is inspected. */
  private readonly inspectCoverage = new RadiusIndicator();
  private readonly levelUpFx = new LevelUpFx();
  private readonly inspectPanel: InspectPanel;
  private readonly budgetPanel: BudgetPanel;
  private readonly advisor: AdvisorPanel;
  private readonly focusMarker = new RadiusIndicator();
  private focusMarkerTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly networkOverlay: NetworkOverlayView;
  private hasPlant = false;
  private hasPump = false;
  private powerInfraCells: ReadonlySet<number> = new Set();
  private waterInfraCells: ReadonlySet<number> = new Set();
  /** Plant + pump footprints — occupy cells like buildings (mirrors sim occupiedCells). */
  private utilityFootprintCells: ReadonlySet<number> = new Set();
  private powerLineCells: ReadonlySet<number> = new Set();
  private pipeCells: ReadonlySet<number> = new Set();
  private lastDisconnectAt = -Infinity;
  private treesView: TreesView | null = null;
  private terrain: TerrainPayload | null = null;
  private roadCells: ReadonlySet<number> = new Set();
  private zonedCells: ReadonlySet<number> = new Set();
  private readonly buildings = new Map<number, BuildingView>();
  private readonly structures = new Map<number, StructureView>();
  /** Cell index -> owning building id, for picking, ghost validity, and occlusion. */
  private readonly buildingCellOwner = new Map<number, number>();
  /** Cell index -> owning structure id (same roles as buildingCellOwner). */
  private readonly structureCellOwner = new Map<number, number>();
  /** Set when road/building/structure footprints change; flushed to trees + zone tint once per frame. */
  private occupancyDirty = false;
  private inspected: Inspected | null = null;
  private activeOverlay: OverlayName = 'none';
  private citizens = 0;
  private demand: DemandState = { r: 0, c: 0, i: 0 };
  private tick = 0;
  private speed: GameSpeed = 1;
  private treasury = 0;
  private taxRates: TaxRates = { r: DEFAULT_TAX_RATE, c: DEFAULT_TAX_RATE, i: DEFAULT_TAX_RATE };
  private lastBudget: BudgetReport = { income: 0, expenses: 0 };
  private vehicles = 0;
  private vehiclesOnScreen = 0;
  private employed = 0;
  private disconnectedTrips = 0;
  private ready = false;

  constructor(container: HTMLElement) {
    this.scene = new CityScene(container, GRID_WIDTH, GRID_HEIGHT);
    this.hud = new Hud<ToolName>(container, TOOL_GROUPS, {
      onSetSpeed: (speed) => this.setSpeed(speed),
      onSelectTool: (tool) => this.tools.setTool(tool),
      onSelectOverlay: (overlay) => this.setOverlay(overlay),
      onToggleBudget: () => {
        this.budgetPanel.toggle();
        this.refreshHud();
      },
      onSave: () => this.send({ type: 'requestSnapshot' }),
      onLoad: () => {
        if (!hasSave()) {
          this.hud.showToast('No save found');
          return;
        }
        // Load = flag + reload: the snapshot applies on the fresh boot while
        // every renderer store is still empty (no per-view reset needed).
        requestLoadOnNextBoot();
        location.reload();
      },
      onNewCity: () => location.reload(),
    });
    this.inspectPanel = new InspectPanel(container, () => this.clearInspect());
    this.budgetPanel = new BudgetPanel(container, (zone, rate) =>
      this.send({ type: 'command', name: 'setTaxRate', data: { zone, rate } }),
    );
    this.advisor = new AdvisorPanel(container, (target) => this.focusProblem(target));

    this.ghost = new GhostView();
    this.roadsView = new RoadsView(GRID_WIDTH);
    this.zonesView = new ZonesView(GRID_WIDTH);
    this.buildingsView = new BuildingsView();
    this.vehiclesView = new VehiclesView(GRID_WIDTH);
    this.structuresView = new StructuresView();
    this.fieldOverlay = new FieldOverlayView(GRID_WIDTH, GRID_HEIGHT);
    this.trafficOverlay = new TrafficOverlayView(GRID_WIDTH);
    this.networksView = new NetworksView(GRID_WIDTH);
    this.networkOverlay = new NetworkOverlayView(GRID_WIDTH, GRID_HEIGHT);
    this.scene.add(
      this.ghost.mesh,
      this.roadsView.group,
      this.zonesView.mesh,
      this.buildingsView.group,
      this.vehiclesView.mesh,
      this.structuresView.group,
      this.fieldOverlay.mesh,
      this.trafficOverlay.mesh,
      this.networksView.group,
      this.networkOverlay.mesh,
      this.focusMarker.group,
      this.radiusIndicator.group,
      this.inspectCoverage.group,
      this.levelUpFx.group,
    );
    this.scene.onFrame(() => {
      this.flushDirtyViews();
      const now = performance.now();
      this.vehiclesView.updateFrame(now);
      this.levelUpFx.updateFrame(now);
      this.scene.setDayFraction((this.tick % TICKS_PER_DAY) / TICKS_PER_DAY);
    });

    this.tools = new Tools({
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
      isWater: (x, y) => this.terrain?.water[cellIndex(x, y)] === 1,
      hasRoad: (index) => this.roadCells.has(index),
      hasBuilding: (index) => this.buildingCellOwner.has(index),
      hasStructure: (index) => this.structureCellOwner.has(index),
      hasUtilityFootprint: (index) => this.utilityFootprintCells.has(index),
      hasPowerLine: (index) => this.powerLineCells.has(index),
      hasPipe: (index) => this.pipeCells.has(index),
      hasZone: (index) => this.zonedCells.has(index),
      submitRoad: (a, b) =>
        this.send({ type: 'command', name: 'placeRoad', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitBulldozeRect: (a, b) =>
        this.send({ type: 'command', name: 'bulldozeRect', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitZone: (zone, a, b) =>
        this.send({ type: 'command', name: 'zone', data: { zone, ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitDezone: (a, b) =>
        this.send({ type: 'command', name: 'dezone', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitPlaceService: (service, anchor) =>
        this.send({ type: 'command', name: 'placeService', data: { service, x: anchor.x, y: anchor.y } }),
      submitPlacePlant: (kind, anchor) =>
        this.send({ type: 'command', name: 'placePowerPlant', data: { kind, x: anchor.x, y: anchor.y } }),
      submitPlacePump: (anchor) =>
        this.send({ type: 'command', name: 'placeWaterPump', data: { x: anchor.x, y: anchor.y } }),
      submitPowerLine: (a, b) =>
        this.send({ type: 'command', name: 'placePowerLine', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitPipe: (a, b) =>
        this.send({ type: 'command', name: 'placePipe', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      inspect: (cell) => this.inspectCell(cell),
      showGhost: (cells, valid, zone) =>
        this.ghost.update(cells, valid, zone ? ZONE_COLORS[zone] : undefined),
      clearGhost: () => {
        this.ghost.clear();
        this.radiusIndicator.hide();
      },
      showRadius: (minX, minY, maxX, maxY) => this.radiusIndicator.show(minX, minY, maxX, maxY),
      notify: (message) => this.hud.showToast(message),
      onToolChanged: (tool) => {
        this.scene.setLeftDragEnabled(tool === 'select');
        this.refreshHud();
      },
    });
    const picker = new GroundPicker(
      this.scene.camera,
      this.scene.renderer.domElement,
      GRID_WIDTH,
      GRID_HEIGHT,
    );
    attachInput(this.scene.renderer.domElement, picker, this.tools);

    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerToClient>) => {
      this.onWorkerMessage(event.data);
    });
    setInterval(() => this.refreshHud(), HUD_REFRESH_MS);
  }

  private send(message: ClientToWorker): void {
    this.worker.postMessage(message);
  }

  private onWorkerMessage(message: WorkerToClient): void {
    switch (message.type) {
      case 'ready':
        // The post-load sync re-sends ready; v1 saves keep the boot seed, so
        // the already-built terrain stays valid and only the first one builds.
        if (this.ready) break;
        this.ready = true;
        this.terrain = message.terrain;
        this.roadsView.setWater(message.terrain.water);
        this.scene.add(buildTerrainMesh(message.terrain));
        this.treesView = new TreesView({ width: message.terrain.width, trees: message.terrain.trees });
        this.scene.add(this.treesView.group);
        this.occupancyDirty = true;
        if (consumePendingLoad()) {
          const save = readSave();
          if (save) this.send({ type: 'loadSnapshot', snapshot: save.snapshot, meta: save.meta });
        }
        break;
      case 'snapshot':
        this.hud.showToast(
          writeSave({ snapshot: message.snapshot, meta: message.meta })
            ? 'City saved'
            : 'Save failed (storage unavailable)',
        );
        break;
      case 'roads':
        this.roadCells = new Set(message.cells);
        this.roadsView.update(message.cells);
        this.vehiclesView.setRoads(message.topologyVersion, message.edges);
        this.trafficOverlay.setRoads(message.edges);
        this.occupancyDirty = true;
        break;
      case 'zones':
        this.zonedCells = new Set(message.cells.map((cell) => cell.i));
        this.zonesView.setZones(message.cells);
        break;
      case 'buildings':
        for (const view of message.upserts) this.applyBuildingUpsert(view);
        for (const id of message.removed) this.applyBuildingRemoval(id);
        this.refreshInspect();
        this.refreshNetworkOverlay();
        break;
      case 'structures':
        for (const view of message.upserts) this.applyStructureUpsert(view);
        for (const id of message.removed) this.applyStructureRemoval(id);
        this.refreshInspect();
        break;
      case 'networks':
        this.networksView.update(message.power, message.water);
        this.hasPlant = message.power.plantCells.length > 0;
        this.hasPump = message.water.pumpCells.length > 0;
        this.powerInfraCells = new Set([...message.power.plantCells, ...message.power.lineCells]);
        this.waterInfraCells = new Set([...message.water.pumpCells, ...message.water.pipeCells]);
        this.utilityFootprintCells = new Set([
          ...message.power.plantCells,
          ...message.water.pumpCells,
        ]);
        this.powerLineCells = new Set(message.power.lineCells);
        this.pipeCells = new Set(message.water.pipeCells);
        this.occupancyDirty = true;
        this.refreshNetworkOverlay();
        break;
      case 'vehicles':
        this.vehiclesOnScreen = message.list.length;
        this.vehiclesView.setVehicles(message.topologyVersion, message.list);
        break;
      case 'traffic': {
        const buckets = new Map(message.edges.map((edge) => [edge.id, edge.bucket]));
        this.vehiclesView.setTraffic(buckets);
        this.trafficOverlay.setBuckets(buckets);
        break;
      }
      case 'field':
        if (message.name === this.activeOverlay) this.fieldOverlay.setField(message);
        break;
      case 'frame':
        this.tick = message.tick;
        this.treasury = message.stats.treasury;
        this.taxRates = message.stats.taxRates;
        this.lastBudget = message.stats.lastBudget;
        this.citizens = message.stats.citizens;
        this.demand = message.stats.demand;
        this.vehicles = message.stats.vehicles;
        this.employed = message.stats.employed;
        if (message.stats.disconnectedTrips > this.disconnectedTrips) {
          this.lastDisconnectAt = performance.now();
        }
        this.disconnectedTrips = message.stats.disconnectedTrips;
        break;
      case 'commandRejected':
        this.hud.showToast(`Command rejected: ${message.message}`);
        break;
    }
  }

  /**
   * Switches the active map overlay. Field overlays subscribe only the chosen
   * field (the worker pushes a snapshot immediately) and stay hidden until
   * that snapshot arrives; the traffic overlay is client-local and needs no
   * subscription.
   */
  private setOverlay(overlay: OverlayName): void {
    if (overlay === this.activeOverlay) return;
    this.activeOverlay = overlay;
    const field = FIELD_OVERLAYS.includes(overlay) ? (overlay as FieldName) : null;
    this.send({ type: 'setFieldSubscriptions', fields: field ? [field] : [] });
    this.fieldOverlay.hide();
    this.trafficOverlay.setActive(overlay === 'traffic');
    this.refreshNetworkOverlay();
    this.refreshHud();
  }

  /** Rebuilds the client-computed power/water overlay when active. */
  private refreshNetworkOverlay(): void {
    if (this.activeOverlay !== 'power' && this.activeOverlay !== 'water') {
      this.networkOverlay.hide();
      return;
    }
    const mode = this.activeOverlay;
    const infrastructure = new Set<number>(
      mode === 'power'
        ? [...this.powerInfraCells]
        : [...this.waterInfraCells],
    );
    const supplied = new Set<number>();
    const problems = new Set<number>();
    for (const view of this.buildings.values()) {
      if (view.abandoned) continue;
      const ok = mode === 'power' ? view.powered : view.watered;
      for (let dy = 0; dy < view.h; dy++) {
        for (let dx = 0; dx < view.w; dx++) {
          (ok ? supplied : problems).add(cellIndex(view.x + dx, view.y + dy));
        }
      }
    }
    // Connection reach: everything within the bridge radius of the network
    // (infrastructure + supplied buildings — both conduct).
    const reach = new Set<number>();
    const expand = (cells: Iterable<number>) => {
      for (const cell of cells) {
        const x = cell % GRID_WIDTH;
        const y = Math.floor(cell / GRID_WIDTH);
        for (let dy = -UTILITY_BRIDGE_RADIUS; dy <= UTILITY_BRIDGE_RADIUS; dy++) {
          for (let dx = -UTILITY_BRIDGE_RADIUS; dx <= UTILITY_BRIDGE_RADIUS; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= GRID_WIDTH || ny >= GRID_HEIGHT) continue;
            reach.add(cellIndex(nx, ny));
          }
        }
      }
    };
    expand(infrastructure);
    expand(supplied);
    this.networkOverlay.update(mode, { infrastructure, reach, supplied, problems });
  }

  private applyBuildingUpsert(view: BuildingView): void {
    const previous = this.buildings.get(view.id);
    // Celebrate genuine level-ups only: a known building whose level rose
    // (boot/load full upserts have no `previous` and stay silent).
    if (previous && !view.abandoned && view.level > previous.level) {
      this.levelUpFx.spawn(
        view.x + view.w / 2,
        view.y + view.h / 2,
        view.level,
        performance.now(),
      );
    }
    const footprintChanged =
      !previous ||
      previous.x !== view.x ||
      previous.y !== view.y ||
      previous.w !== view.w ||
      previous.h !== view.h;
    if (previous && footprintChanged) this.setFootprintOwner(previous, null);
    this.buildings.set(view.id, view);
    if (footprintChanged) {
      this.setFootprintOwner(view, view.id);
      this.occupancyDirty = true;
    }
    this.buildingsView.upsert(view);
  }

  /** The removal stream covers all destroyed entities (citizens too) — ignore non-buildings. */
  private applyBuildingRemoval(id: number): void {
    const previous = this.buildings.get(id);
    if (!previous) return;
    this.setFootprintOwner(previous, null);
    this.buildings.delete(id);
    this.buildingsView.remove(id);
    this.occupancyDirty = true;
  }

  private setFootprintOwner(view: BuildingView, owner: number | null): void {
    for (let dy = 0; dy < view.h; dy++) {
      for (let dx = 0; dx < view.w; dx++) {
        const index = cellIndex(view.x + dx, view.y + dy);
        if (owner === null) this.buildingCellOwner.delete(index);
        else this.buildingCellOwner.set(index, owner);
      }
    }
  }

  private applyStructureUpsert(view: StructureView): void {
    this.structures.set(view.id, view);
    for (let dy = 0; dy < view.h; dy++) {
      for (let dx = 0; dx < view.w; dx++) {
        this.structureCellOwner.set(cellIndex(view.x + dx, view.y + dy), view.id);
      }
    }
    this.structuresView.upsert(view);
    this.occupancyDirty = true;
  }

  /** The removal stream covers all destroyed entities — ignore non-structures. */
  private applyStructureRemoval(id: number): void {
    const previous = this.structures.get(id);
    if (!previous) return;
    this.structures.delete(id);
    for (let dy = 0; dy < previous.h; dy++) {
      for (let dx = 0; dx < previous.w; dx++) {
        this.structureCellOwner.delete(cellIndex(previous.x + dx, previous.y + dy));
      }
    }
    this.structuresView.remove(id);
    this.occupancyDirty = true;
  }

  /** Once per frame: propagate occupancy changes to trees + zone tint, then rebuild the tint. */
  private flushDirtyViews(): void {
    if (this.occupancyDirty) {
      this.occupancyDirty = false;
      const footprintCells = new Set(this.buildingCellOwner.keys());
      for (const index of this.structureCellOwner.keys()) footprintCells.add(index);
      this.zonesView.setOccludedCells(footprintCells);
      const occupied = new Set<number>(footprintCells);
      for (const index of this.roadCells) occupied.add(index);
      for (const index of this.networksView.occupiedCells) occupied.add(index);
      this.treesView?.updateOccupied(occupied);
    }
    this.zonesView.flushIfDirty();
  }

  private inspectCell(cell: Cell | null): void {
    const index = cell ? cellIndex(cell.x, cell.y) : null;
    const structureId = index === null ? undefined : this.structureCellOwner.get(index);
    if (structureId !== undefined) {
      this.inspected = { kind: 'structure', id: structureId };
      this.refreshInspect();
      return;
    }
    const buildingId = index === null ? undefined : this.buildingCellOwner.get(index);
    if (buildingId === undefined) {
      this.clearInspect();
      return;
    }
    this.inspected = { kind: 'building', id: buildingId };
    this.refreshInspect();
  }

  private clearInspect(): void {
    this.inspected = null;
    this.inspectPanel.hide();
    this.inspectCoverage.hide();
  }

  /** Syncs the panel with the inspected object's latest view (or closes it when gone). */
  private refreshInspect(): void {
    if (this.inspected === null) return;
    if (this.inspected.kind === 'structure') {
      const view = this.structures.get(this.inspected.id);
      if (!view) {
        this.clearInspect();
        return;
      }
      // Show the live coverage square — same Chebyshev box the sim marks
      // (anchored on the structure's top-left cell, like placement previews).
      const r = SERVICE_RADIUS[view.service];
      this.inspectCoverage.show(view.x - r, view.y - r, view.x + r, view.y + r);
      this.inspectPanel.show({
        title: SERVICE_LABELS[view.service],
        lines: [
          `Footprint: ${view.w}×${view.h} cells`,
          `Coverage radius: ${SERVICE_RADIUS[view.service]} cells (shown on the map)`,
        ],
        abandoned: false,
      });
      return;
    }
    this.inspectCoverage.hide();
    const view = this.buildings.get(this.inspected.id);
    if (!view) {
      this.clearInspect();
      return;
    }
    this.inspectPanel.show({
      title: `${ZONE_LABELS[view.zone]} — Level ${view.level}`,
      lines: [`Footprint: ${view.w}×${view.h} cells`, this.occupancyLine(view)],
      abandoned: view.abandoned,
    });
  }

  /** R shows residents as people (×PEOPLE_PER_CITIZEN); C/I show job slots filled/capacity. */
  private occupancyLine(view: BuildingView): string {
    const levelIndex = Math.min(Math.max(view.level, 1), 3) - 1;
    const capacity = CAPACITY_PER_CELL[view.zone][levelIndex] * view.w * view.h;
    if (view.zone === 'R') {
      const people = view.residents * PEOPLE_PER_CITIZEN;
      return `Residents: ${people} / ${capacity * PEOPLE_PER_CITIZEN} people`;
    }
    return `Jobs: ${view.jobsFilled} / ${capacity}`;
  }

  private refreshHud(): void {
    this.hud.update({
      day: Math.floor(this.tick / TICKS_PER_DAY) + 1,
      speed: this.speed,
      treasury: this.treasury,
      populationPeople: this.citizens * PEOPLE_PER_CITIZEN,
      demand: this.demand,
      activeTool: this.tools.activeTool,
      activeOverlay: this.activeOverlay,
      vehicles: this.vehicles,
      disconnectedTrips: this.disconnectedTrips,
    });
    this.budgetPanel.update(this.taxRates, this.lastBudget);
    this.advisor.update(this.computeAdvisories());
  }

  /**
   * What the city lacks or what's going wrong, in priority order — feeds the
   * rolling advisor banner. Computed from client mirrors only.
   */
  private computeAdvisories(): Advisory[] {
    const out: Advisory[] = [];
    const live = [...this.buildings.values()].filter((b) => !b.abandoned);
    const abandoned = this.buildings.size - live.length;
    const unpowered = live.filter((b) => !b.powered);
    const unwatered = live.filter((b) => !b.watered);
    // Deterministic "show me" target: the lowest-id matching building.
    const firstOf = (views: BuildingView[]): { x: number; y: number } | undefined => {
      let best: BuildingView | null = null;
      for (const view of views) if (!best || view.id < best.id) best = view;
      return best ? { x: best.x, y: best.y } : undefined;
    };
    const firstAbandoned = firstOf([...this.buildings.values()].filter((b) => b.abandoned));

    if (this.treasury < 0) {
      out.push({
        id: 'broke',
        text: '💸 The city is broke — only power/water purchases are allowed until income recovers.',
      });
    }
    if (this.roadCells.size === 0) {
      out.push({ id: 'firstRoad', text: '🛣 Draw a Road to found your city — everything grows along roads.' });
      return out;
    }
    if (this.zonedCells.size === 0 && this.buildings.size === 0) {
      out.push({
        id: 'firstZones',
        text: '🏘 Paint Zone R (homes), Zone C (shops), and Zone I (jobs) within 2 cells of a road.',
      });
    }
    if (!this.hasPlant && this.buildings.size > 0) {
      out.push({
        id: 'noPower',
        text: '⚡ No power source — buildings will abandon. Place a Coal or Wind plant and drag Lines to your districts.',
        target: firstOf(live),
      });
    } else if (unpowered.length > 0) {
      out.push({
        id: 'unpowered',
        text: `⚡ ${unpowered.length} building${unpowered.length === 1 ? ' lacks' : 's lack'} power — extend Lines to within reach.`,
        target: firstOf(unpowered),
      });
    }
    if (!this.hasPump && this.buildings.size > 0) {
      out.push({
        id: 'noWater',
        text: '💧 No water pump — buildings will abandon. Place a Pump beside water and drag Pipes to your districts.',
        target: firstOf(live),
      });
    } else if (unwatered.length > 0) {
      out.push({
        id: 'unwatered',
        text: `💧 ${unwatered.length} building${unwatered.length === 1 ? ' lacks' : 's lack'} water — extend Pipes to within reach.`,
        target: firstOf(unwatered),
      });
    }
    if (abandoned > 0) {
      out.push({
        id: 'abandoned',
        text: `🏚 ${abandoned} abandoned building${abandoned === 1 ? '' : 's'} — fix power, water, or nearby pollution and they recover on their own.`,
        target: firstAbandoned,
      });
    }
    if (performance.now() - this.lastDisconnectAt < 15_000) {
      out.push({
        id: 'disconnected',
        text: '🚧 Commuters can’t reach their jobs — connect your districts with roads (they bridge over water at $40/cell).',
      });
    }
    if (this.demand.r > 0.5) out.push({ id: 'demandR', text: '🟩 Housing demand is high — zone more Residential.' });
    if (this.demand.c > 0.5) out.push({ id: 'demandC', text: '🟦 Commercial demand is high — zone more Commercial.' });
    if (this.demand.i > 0.5) out.push({ id: 'demandI', text: '🟧 Industrial demand is high — zone more Industrial.' });
    const unemployed = this.citizens - this.employed;
    if (this.citizens > 10 && unemployed > this.citizens * 0.4 && (this.demand.i > 0 || this.demand.c > 0)) {
      out.push({
        id: 'unemployed',
        text: '👷 Many citizens are unemployed — zone Commercial or Industrial for jobs.',
      });
    }
    if (out.length === 0 && this.buildings.size > 0) {
      out.push({ id: 'healthy', text: '✅ The city is healthy — keep growing!' });
    }
    return out.slice(0, 6);
  }

  /** Advisor click-through: fly to the problem and flash a highlight on it. */
  private focusProblem(target: { x: number; y: number }): void {
    this.scene.flyTo(target.x + 0.5, target.y + 0.5);
    this.focusMarker.show(target.x - 1, target.y - 1, target.x + 2, target.y + 2);
    if (this.focusMarkerTimer !== undefined) clearTimeout(this.focusMarkerTimer);
    this.focusMarkerTimer = setTimeout(() => this.focusMarker.hide(), 2500);
  }

  setSpeed(speed: GameSpeed): void {
    this.speed = speed;
    this.send({ type: 'setSpeed', speed });
  }

  /** Automation hook: advance the sim by wall-clock-equivalent ms at 1x. */
  advanceTime(ms: number): void {
    this.send({ type: 'advance', ticks: Math.max(1, Math.round(ms / TICK_MS)) });
  }

  /** Automation hook: coarse machine-readable game state. */
  getTextState(): Record<string, unknown> {
    const target = this.scene.getCameraTarget();
    return {
      ready: this.ready,
      tick: this.tick,
      day: Math.floor(this.tick / TICKS_PER_DAY) + 1,
      speed: this.speed,
      fps: this.scene.getFps(),
      advisories: this.advisor.current(),
      treasury: this.treasury,
      taxRates: this.taxRates,
      lastBudget: { income: round2(this.lastBudget.income), expenses: round2(this.lastBudget.expenses) },
      budgetPanelOpen: this.budgetPanel.visible,
      populationPeople: this.citizens * PEOPLE_PER_CITIZEN,
      demand: { r: round2(this.demand.r), c: round2(this.demand.c), i: round2(this.demand.i) },
      activeTool: this.tools.activeTool,
      activeOverlay: this.activeOverlay,
      roadCellCount: this.roadsView.cellCount,
      bridgeCellCount: this.roadsView.bridgeCellCount,
      levelUpsCelebrated: this.levelUpFx.celebrated,
      zonedCellCount: this.zonedCells.size,
      buildingCount: this.buildings.size,
      structureCount: this.structures.size,
      vehiclesOnScreen: this.vehiclesOnScreen,
      employed: this.employed,
      disconnectedTrips: this.disconnectedTrips,
      inspect: this.inspectTextState(),
      cameraTarget: { x: round2(target.x), y: round2(target.y), z: round2(target.z) },
    };
  }

  private inspectTextState(): Record<string, unknown> | null {
    if (this.inspected === null) return null;
    if (this.inspected.kind === 'structure') {
      const view = this.structures.get(this.inspected.id);
      if (!view) return null;
      return {
        id: view.id,
        kind: 'service',
        service: view.service,
        x: view.x,
        y: view.y,
        w: view.w,
        h: view.h,
        coverageRadius: SERVICE_RADIUS[view.service],
      };
    }
    const view = this.buildings.get(this.inspected.id);
    if (!view) return null;
    return {
      id: view.id,
      kind: 'rci',
      zone: view.zone,
      level: view.level,
      x: view.x,
      y: view.y,
      w: view.w,
      h: view.h,
      abandoned: view.abandoned,
      residents: view.residents,
      jobsFilled: view.jobsFilled,
    };
  }
}
