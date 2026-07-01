import { cellIndex, lPathCells, type Cell } from '../sim/grid';

export type ToolName = 'select' | 'road' | 'bulldoze';

export const TOOL_LIST: { id: ToolName; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'road', label: 'Road' },
  { id: 'bulldoze', label: 'Bulldoze' },
];

/** Everything the tool state machine needs from the composition root. */
export interface ToolHost {
  gridWidth: number;
  isWater(x: number, y: number): boolean;
  hasRoad(index: number): boolean;
  submitRoad(a: Cell, b: Cell): void;
  submitBulldoze(a: Cell, b: Cell): void;
  showGhost(cells: Cell[], valid: boolean): void;
  clearGhost(): void;
  onToolChanged(tool: ToolName): void;
}

/**
 * Active tool + drag state machine. Pointer events arrive pre-picked as sim
 * cells (null when off-grid). Road/bulldoze drags preview the L-path via the
 * ghost and submit a single command on release; the ghost validity check is a
 * client-side convenience only — the sim validates authoritatively.
 */
export class Tools {
  activeTool: ToolName = 'select';
  private dragAnchor: Cell | null = null;

  constructor(private readonly host: ToolHost) {}

  get isBuildTool(): boolean {
    return this.activeTool === 'road' || this.activeTool === 'bulldoze';
  }

  get dragging(): boolean {
    return this.dragAnchor !== null;
  }

  setTool(tool: ToolName): void {
    if (tool === this.activeTool) return;
    this.dragAnchor = null;
    this.activeTool = tool;
    this.host.clearGhost();
    this.host.onToolChanged(tool);
  }

  pointerDown(cell: Cell | null): void {
    if (!this.isBuildTool || !cell) return;
    this.dragAnchor = cell;
    this.refreshGhost(cell);
  }

  pointerMove(cell: Cell | null): void {
    if (!this.isBuildTool) return;
    if (cell) {
      this.refreshGhost(cell);
    } else if (!this.dragAnchor) {
      this.host.clearGhost();
    }
  }

  pointerUp(cell: Cell | null): void {
    if (!this.dragAnchor) return;
    const a = this.dragAnchor;
    const b = cell ?? a;
    this.dragAnchor = null;
    if (this.activeTool === 'road') this.host.submitRoad(a, b);
    else if (this.activeTool === 'bulldoze') this.host.submitBulldoze(a, b);
    this.host.clearGhost();
  }

  cancelDrag(): void {
    if (!this.dragAnchor) return;
    this.dragAnchor = null;
    this.host.clearGhost();
  }

  /** Shows the L-path from the drag anchor (or a 1-cell hover preview) at `current`. */
  private refreshGhost(current: Cell): void {
    const cells = lPathCells(this.dragAnchor ?? current, current);
    this.host.showGhost(cells, this.isPathValid(cells));
  }

  /** Road: trivially invalid when any cell is water. Bulldoze: when no cell has a road. */
  private isPathValid(cells: Cell[]): boolean {
    if (this.activeTool === 'road') {
      return !cells.some((cell) => this.host.isWater(cell.x, cell.y));
    }
    return cells.some((cell) => this.host.hasRoad(cellIndex(cell.x, cell.y, this.host.gridWidth)));
  }
}
