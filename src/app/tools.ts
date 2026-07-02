import { SERVICE_FOOTPRINT } from '../sim/constants/services';
import { ZONE_MAX_ROAD_DISTANCE } from '../sim/constants/zoning';
import { cellIndex, lPathCells, type Cell } from '../sim/grid';
import type { ServiceType, ZoneType } from '../sim/types';

export type ToolName =
  | 'select'
  | 'road'
  | 'bulldoze'
  | 'zoneR'
  | 'zoneC'
  | 'zoneI'
  | 'dezone'
  | 'fire'
  | 'police'
  | 'clinic'
  | 'school';

/** Toolbar layout: [Select] | [Road, Bulldoze, Dezone] | [Zone R, C, I] | [services x4]. */
export const TOOL_GROUPS: { id: ToolName; label: string }[][] = [
  [{ id: 'select', label: 'Select' }],
  [
    { id: 'road', label: 'Road' },
    { id: 'bulldoze', label: 'Bulldoze' },
    { id: 'dezone', label: 'Dezone' },
  ],
  [
    { id: 'zoneR', label: 'Zone R' },
    { id: 'zoneC', label: 'Zone C' },
    { id: 'zoneI', label: 'Zone I' },
  ],
  [
    { id: 'fire', label: 'Fire' },
    { id: 'police', label: 'Police' },
    { id: 'clinic', label: 'Clinic' },
    { id: 'school', label: 'School' },
  ],
];

const ZONE_BY_TOOL: Partial<Record<ToolName, ZoneType>> = { zoneR: 'R', zoneC: 'C', zoneI: 'I' };
const SERVICE_BY_TOOL: Partial<Record<ToolName, ServiceType>> = {
  fire: 'fireStation',
  police: 'police',
  clinic: 'clinic',
  school: 'school',
};

/** Everything the tool state machine needs from the composition root. */
export interface ToolHost {
  gridWidth: number;
  gridHeight: number;
  isWater(x: number, y: number): boolean;
  hasRoad(index: number): boolean;
  hasBuilding(index: number): boolean;
  hasStructure(index: number): boolean;
  hasZone(index: number): boolean;
  submitRoad(a: Cell, b: Cell): void;
  submitBulldozeRect(a: Cell, b: Cell): void;
  submitZone(zone: ZoneType, a: Cell, b: Cell): void;
  submitDezone(a: Cell, b: Cell): void;
  /** Service placement; anchor = top-left of the SERVICE_FOOTPRINT square. */
  submitPlaceService(service: ServiceType, anchor: Cell): void;
  /** Select-tool click; null = off-grid (clears any open inspection). */
  inspect(cell: Cell | null): void;
  showGhost(cells: Cell[], valid: boolean, zone?: ZoneType): void;
  clearGhost(): void;
  onToolChanged(tool: ToolName): void;
}

/** All cells of the inclusive rectangle between two corner cells, row-major. */
export function rectCells(a: Cell, b: Cell): Cell[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const cells: Cell[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) cells.push({ x, y });
  }
  return cells;
}

/**
 * Active tool + drag state machine. Pointer events arrive pre-picked as sim
 * cells (null when off-grid). Road drags preview the L-path; bulldoze, zone,
 * and dezone drags preview the full rectangle between anchor and current cell.
 * A single command is submitted on release; the ghost validity check is a
 * client-side convenience only — the sim validates authoritatively. Service
 * tools are click-to-place stamps: the ghost previews the footprint on hover
 * and pointer-down submits immediately (no drag).
 */
export class Tools {
  activeTool: ToolName = 'select';
  private dragAnchor: Cell | null = null;

  constructor(private readonly host: ToolHost) {}

  /** Every tool except select owns left-drag (select leaves it to camera pan). */
  get isBuildTool(): boolean {
    return this.activeTool !== 'select';
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
    const service = SERVICE_BY_TOOL[this.activeTool];
    if (service) {
      this.host.submitPlaceService(service, cell);
      this.refreshGhost(cell);
      return;
    }
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
    const zone = ZONE_BY_TOOL[this.activeTool];
    if (this.activeTool === 'road') this.host.submitRoad(a, b);
    else if (this.activeTool === 'bulldoze') this.host.submitBulldozeRect(a, b);
    else if (this.activeTool === 'dezone') this.host.submitDezone(a, b);
    else if (zone) this.host.submitZone(zone, a, b);
    this.host.clearGhost();
  }

  /** Select-tool click (no drag): forwards the cell for inspection. */
  select(cell: Cell | null): void {
    if (this.activeTool !== 'select') return;
    this.host.inspect(cell);
  }

  cancelDrag(): void {
    if (!this.dragAnchor) return;
    this.dragAnchor = null;
    this.host.clearGhost();
  }

  /**
   * Shows the L-path (road), the service footprint, or the rect (others) from
   * the drag anchor (or a 1-cell / footprint hover preview).
   */
  private refreshGhost(current: Cell): void {
    if (SERVICE_BY_TOOL[this.activeTool]) {
      const cells = this.footprintCells(current);
      this.host.showGhost(cells, this.isFootprintPlaceable(cells));
      return;
    }
    const anchor = this.dragAnchor ?? current;
    const cells = this.activeTool === 'road' ? lPathCells(anchor, current) : rectCells(anchor, current);
    this.host.showGhost(cells, this.isSelectionValid(cells), ZONE_BY_TOOL[this.activeTool]);
  }

  /** In-bounds cells of the SERVICE_FOOTPRINT square anchored (top-left) at the given cell. */
  private footprintCells(anchor: Cell): Cell[] {
    const cells: Cell[] = [];
    for (let dy = 0; dy < SERVICE_FOOTPRINT; dy++) {
      for (let dx = 0; dx < SERVICE_FOOTPRINT; dx++) {
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (x < this.host.gridWidth && y < this.host.gridHeight) cells.push({ x, y });
      }
    }
    return cells;
  }

  /** Full footprint in bounds and every cell free of water, roads, buildings, and structures. */
  private isFootprintPlaceable(cells: Cell[]): boolean {
    if (cells.length !== SERVICE_FOOTPRINT * SERVICE_FOOTPRINT) return false;
    return cells.every((cell) => {
      const index = cellIndex(cell.x, cell.y, this.host.gridWidth);
      return (
        !this.host.isWater(cell.x, cell.y) &&
        !this.host.hasRoad(index) &&
        !this.host.hasBuilding(index) &&
        !this.host.hasStructure(index)
      );
    });
  }

  /**
   * Road: invalid when any cell is water. Bulldoze: needs ≥1 road, building,
   * or structure cell. Dezone: needs ≥1 zoned cell. Zone: needs ≥1 zoneable
   * cell (land, non-road, within Chebyshev ZONE_MAX_ROAD_DISTANCE of a road).
   */
  private isSelectionValid(cells: Cell[]): boolean {
    const index = (cell: Cell): number => cellIndex(cell.x, cell.y, this.host.gridWidth);
    switch (this.activeTool) {
      case 'road':
        return !cells.some((cell) => this.host.isWater(cell.x, cell.y));
      case 'bulldoze':
        return cells.some(
          (cell) =>
            this.host.hasRoad(index(cell)) ||
            this.host.hasBuilding(index(cell)) ||
            this.host.hasStructure(index(cell)),
        );
      case 'dezone':
        return cells.some((cell) => this.host.hasZone(index(cell)));
      case 'zoneR':
      case 'zoneC':
      case 'zoneI':
        return cells.some((cell) => this.isZoneable(cell));
      default:
        return true;
    }
  }

  private isZoneable(cell: Cell): boolean {
    if (this.host.isWater(cell.x, cell.y)) return false;
    if (this.host.hasRoad(cellIndex(cell.x, cell.y, this.host.gridWidth))) return false;
    return this.isNearRoad(cell);
  }

  private isNearRoad(cell: Cell): boolean {
    const reach = ZONE_MAX_ROAD_DISTANCE;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= this.host.gridWidth || y >= this.host.gridHeight) continue;
        if (this.host.hasRoad(cellIndex(x, y, this.host.gridWidth))) return true;
      }
    }
    return false;
  }
}
