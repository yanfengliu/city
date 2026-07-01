import { BuildingsView } from '../rendering/buildings-mesh';
import { ZONE_COLORS } from '../rendering/constants';
import { CityScene } from '../rendering/scene';
import { GhostView } from '../rendering/ghost';
import { GroundPicker } from '../rendering/picking';
import { RoadsView } from '../rendering/roads-mesh';
import { buildTerrainMesh } from '../rendering/terrain-mesh';
import { TreesView } from '../rendering/trees';
import { ZonesView } from '../rendering/zones-mesh';
import { Hud } from '../ui/hud';
import { InspectPanel } from '../ui/inspect-panel';
import { GRID_HEIGHT, GRID_WIDTH, TICK_MS } from '../sim/constants/map';
import { CAPACITY_PER_CELL, PEOPLE_PER_CITIZEN } from '../sim/constants/zoning';
import { cellIndex, type Cell } from '../sim/grid';
import { attachInput } from './input';
import { TOOL_GROUPS, Tools, type ToolName } from './tools';
import type {
  BuildingView,
  ClientToWorker,
  GameSpeed,
  TerrainPayload,
  WorkerToClient,
} from '../protocol/messages';
import type { DemandState, ZoneType } from '../sim/types';

const HUD_REFRESH_MS = 250;
const ZONE_LABELS: Record<ZoneType, string> = {
  R: 'Residential',
  C: 'Commercial',
  I: 'Industrial',
};

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
  private readonly inspectPanel: InspectPanel;
  private treesView: TreesView | null = null;
  private terrain: TerrainPayload | null = null;
  private roadCells: ReadonlySet<number> = new Set();
  private zonedCells: ReadonlySet<number> = new Set();
  private readonly buildings = new Map<number, BuildingView>();
  /** Cell index -> owning building id, for picking, ghost validity, and occlusion. */
  private readonly buildingCellOwner = new Map<number, number>();
  /** Set when road/building footprints change; flushed to trees + zone tint once per frame. */
  private occupancyDirty = false;
  private inspectedId: number | null = null;
  private citizens = 0;
  private demand: DemandState = { r: 0, c: 0, i: 0 };
  private tick = 0;
  private speed: GameSpeed = 1;
  private treasury = 0;
  private ready = false;

  constructor(container: HTMLElement) {
    this.scene = new CityScene(container, GRID_WIDTH, GRID_HEIGHT);
    this.hud = new Hud<ToolName>(container, TOOL_GROUPS, {
      onSetSpeed: (speed) => this.setSpeed(speed),
      onSelectTool: (tool) => this.tools.setTool(tool),
    });
    this.inspectPanel = new InspectPanel(container, () => this.clearInspect());

    this.ghost = new GhostView();
    this.roadsView = new RoadsView(GRID_WIDTH);
    this.zonesView = new ZonesView(GRID_WIDTH);
    this.buildingsView = new BuildingsView();
    this.scene.add(this.ghost.mesh, this.roadsView.mesh, this.zonesView.mesh, this.buildingsView.group);
    this.scene.onFrame(() => this.flushDirtyViews());

    this.tools = new Tools({
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
      isWater: (x, y) => this.terrain?.water[cellIndex(x, y)] === 1,
      hasRoad: (index) => this.roadCells.has(index),
      hasBuilding: (index) => this.buildingCellOwner.has(index),
      hasZone: (index) => this.zonedCells.has(index),
      submitRoad: (a, b) =>
        this.send({ type: 'command', name: 'placeRoad', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitBulldozeRect: (a, b) =>
        this.send({ type: 'command', name: 'bulldozeRect', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitZone: (zone, a, b) =>
        this.send({ type: 'command', name: 'zone', data: { zone, ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitDezone: (a, b) =>
        this.send({ type: 'command', name: 'dezone', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      inspect: (cell) => this.inspectCell(cell),
      showGhost: (cells, valid, zone) =>
        this.ghost.update(cells, valid, zone ? ZONE_COLORS[zone] : undefined),
      clearGhost: () => this.ghost.clear(),
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
        if (this.ready) break;
        this.ready = true;
        this.terrain = message.terrain;
        this.scene.add(buildTerrainMesh(message.terrain));
        this.treesView = new TreesView({ width: message.terrain.width, trees: message.terrain.trees });
        this.scene.add(this.treesView.group);
        this.occupancyDirty = true;
        break;
      case 'roads':
        this.roadCells = new Set(message.cells);
        this.roadsView.update(message.cells);
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
        break;
      case 'frame':
        this.tick = message.tick;
        this.treasury = message.stats.treasury;
        this.citizens = message.stats.citizens;
        this.demand = message.stats.demand;
        break;
      case 'commandRejected':
        this.hud.showToast(`Command rejected: ${message.message}`);
        break;
    }
  }

  private applyBuildingUpsert(view: BuildingView): void {
    const previous = this.buildings.get(view.id);
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

  /** Once per frame: propagate occupancy changes to trees + zone tint, then rebuild the tint. */
  private flushDirtyViews(): void {
    if (this.occupancyDirty) {
      this.occupancyDirty = false;
      const buildingCells = new Set(this.buildingCellOwner.keys());
      this.zonesView.setOccludedCells(buildingCells);
      const occupied = new Set<number>(buildingCells);
      for (const index of this.roadCells) occupied.add(index);
      this.treesView?.updateOccupied(occupied);
    }
    this.zonesView.flushIfDirty();
  }

  private inspectCell(cell: Cell | null): void {
    const id = cell ? this.buildingCellOwner.get(cellIndex(cell.x, cell.y)) : undefined;
    if (id === undefined) {
      this.clearInspect();
      return;
    }
    this.inspectedId = id;
    this.refreshInspect();
  }

  private clearInspect(): void {
    this.inspectedId = null;
    this.inspectPanel.hide();
  }

  /** Syncs the panel with the inspected building's latest view (or closes it when gone). */
  private refreshInspect(): void {
    if (this.inspectedId === null) return;
    const view = this.buildings.get(this.inspectedId);
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
      tick: this.tick,
      fps: this.scene.getFps(),
      speed: this.speed,
      treasury: this.treasury,
      populationPeople: this.citizens * PEOPLE_PER_CITIZEN,
      demand: this.demand,
      activeTool: this.tools.activeTool,
    });
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
    const inspected = this.inspectedId === null ? null : this.buildings.get(this.inspectedId);
    return {
      ready: this.ready,
      tick: this.tick,
      speed: this.speed,
      fps: this.scene.getFps(),
      treasury: this.treasury,
      populationPeople: this.citizens * PEOPLE_PER_CITIZEN,
      demand: { r: round2(this.demand.r), c: round2(this.demand.c), i: round2(this.demand.i) },
      activeTool: this.tools.activeTool,
      roadCellCount: this.roadsView.cellCount,
      zonedCellCount: this.zonedCells.size,
      buildingCount: this.buildings.size,
      inspect: inspected
        ? {
            id: inspected.id,
            zone: inspected.zone,
            level: inspected.level,
            x: inspected.x,
            y: inspected.y,
            w: inspected.w,
            h: inspected.h,
            abandoned: inspected.abandoned,
            residents: inspected.residents,
            jobsFilled: inspected.jobsFilled,
          }
        : null,
      cameraTarget: { x: round2(target.x), y: round2(target.y), z: round2(target.z) },
    };
  }
}
