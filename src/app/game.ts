import { CityScene } from '../rendering/scene';
import { GhostView } from '../rendering/ghost';
import { GroundPicker } from '../rendering/picking';
import { RoadsView } from '../rendering/roads-mesh';
import { buildTerrainMesh } from '../rendering/terrain-mesh';
import { TreesView } from '../rendering/trees';
import { Hud } from '../ui/hud';
import { GRID_HEIGHT, GRID_WIDTH, TICK_MS } from '../sim/constants/map';
import { cellIndex } from '../sim/grid';
import { attachInput } from './input';
import { TOOL_LIST, Tools, type ToolName } from './tools';
import type { ClientToWorker, GameSpeed, TerrainPayload, WorkerToClient } from '../protocol/messages';

const HUD_REFRESH_MS = 250;

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
  private treesView: TreesView | null = null;
  private terrain: TerrainPayload | null = null;
  private roadCells: ReadonlySet<number> = new Set();
  private tick = 0;
  private speed: GameSpeed = 1;
  private treasury = 0;
  private ready = false;

  constructor(container: HTMLElement) {
    this.scene = new CityScene(container, GRID_WIDTH, GRID_HEIGHT);
    this.hud = new Hud<ToolName>(container, TOOL_LIST, {
      onSetSpeed: (speed) => this.setSpeed(speed),
      onSelectTool: (tool) => this.tools.setTool(tool),
    });

    this.ghost = new GhostView();
    this.roadsView = new RoadsView(GRID_WIDTH);
    this.scene.add(this.ghost.mesh, this.roadsView.mesh);

    this.tools = new Tools({
      gridWidth: GRID_WIDTH,
      isWater: (x, y) => this.terrain?.water[cellIndex(x, y)] === 1,
      hasRoad: (index) => this.roadCells.has(index),
      submitRoad: (a, b) =>
        this.send({ type: 'command', name: 'placeRoad', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      submitBulldoze: (a, b) =>
        this.send({ type: 'command', name: 'bulldozeRoad', data: { ax: a.x, ay: a.y, bx: b.x, by: b.y } }),
      showGhost: (cells, valid) => this.ghost.update(cells, valid),
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
        this.treesView.updateRoads(this.roadCells);
        this.scene.add(this.treesView.group);
        break;
      case 'roads':
        this.roadCells = new Set(message.cells);
        this.roadsView.update(message.cells);
        this.treesView?.updateRoads(this.roadCells);
        break;
      case 'frame':
        this.tick = message.tick;
        this.treasury = message.stats.treasury;
        break;
      case 'commandRejected':
        this.hud.showToast(`Command rejected: ${message.message}`);
        break;
    }
  }

  private refreshHud(): void {
    this.hud.update({
      tick: this.tick,
      fps: this.scene.getFps(),
      speed: this.speed,
      treasury: this.treasury,
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
    return {
      ready: this.ready,
      tick: this.tick,
      speed: this.speed,
      fps: this.scene.getFps(),
      treasury: this.treasury,
      activeTool: this.tools.activeTool,
      roadCellCount: this.roadsView.cellCount,
      cameraTarget: { x: round2(target.x), y: round2(target.y), z: round2(target.z) },
    };
  }
}
