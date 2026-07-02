import { SERVICE_FOOTPRINT, SERVICE_RADIUS } from '../sim/constants/services';
import { POWER_PLANT_FOOTPRINT, UTILITY_BRIDGE_RADIUS } from '../sim/constants/utilities';
import { ZONE_MAX_ROAD_DISTANCE } from '../sim/constants/zoning';
import { cellIndex, lPathCells, type Cell } from '../sim/grid';
import type { PowerPlantKind, ServiceType, ZoneType } from '../sim/types';

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
  | 'school'
  | 'coal'
  | 'wind'
  | 'powerLine'
  | 'pump'
  | 'pipe';

/** Toolbar layout: [Select] | [Road, Bulldoze, Dezone] | [Zone R, C, I] | [services x4] | [utilities x5]. */
export const TOOL_GROUPS: { id: ToolName; label: string; title: string }[][] = [
  [{ id: 'select', label: 'Select', title: 'Click a building for details; left-drag pans the camera' }],
  [
    { id: 'road', label: 'Road', title: 'Drag to draw a road ($10/cell). Buildings grow along roads; traffic drives on them' },
    { id: 'bulldoze', label: 'Bulldoze', title: 'Drag a rectangle to demolish roads, buildings, services, and utilities (25% road refund)' },
    { id: 'dezone', label: 'Dezone', title: 'Drag a rectangle to erase zoning (does not touch grown buildings)' },
  ],
  [
    { id: 'zoneR', label: 'Zone R', title: 'Residential: homes grow here when demand is green. Zone within 2 cells of a road' },
    { id: 'zoneC', label: 'Zone C', title: 'Commercial: shops with jobs. Zone within 2 cells of a road' },
    { id: 'zoneI', label: 'Zone I', title: 'Industrial: jobs, but pollutes its surroundings. Keep away from homes' },
  ],
  [
    { id: 'fire', label: 'Fire', title: 'Fire station ($400): raises land value within 24 cells' },
    { id: 'police', label: 'Police', title: 'Police station ($400): raises land value within 24 cells' },
    { id: 'clinic', label: 'Clinic', title: 'Clinic ($500): raises land value within 32 cells' },
    { id: 'school', label: 'School', title: 'School ($500): raises land value within 32 cells and lets buildings reach level 3' },
  ],
  [
    { id: 'coal', label: 'Coal ⚡', title: 'Coal plant ($800, 3x3): powers 400 units but pollutes. Buildings within 2 cells of the plant, a Line, or another powered building get power' },
    { id: 'wind', label: 'Wind ⚡', title: 'Wind turbine ($300, 1x1): clean but small (40 units). Same 2-cell connection rule' },
    { id: 'powerLine', label: 'Line', title: 'Power line ($4/cell): drag from a plant toward your districts; may cross roads. Anything within 2 cells connects' },
    { id: 'pump', label: 'Pump 💧', title: 'Water pump ($500): place on land RIGHT NEXT to water. Supplies 300 units through Pipes' },
    { id: 'pipe', label: 'Pipe', title: 'Water pipe ($3/cell): runs under roads and buildings. Anything within 2 cells of a pump-connected pipe gets water' },
  ],
];

const ZONE_BY_TOOL: Partial<Record<ToolName, ZoneType>> = { zoneR: 'R', zoneC: 'C', zoneI: 'I' };
const SERVICE_BY_TOOL: Partial<Record<ToolName, ServiceType>> = {
  fire: 'fireStation',
  police: 'police',
  clinic: 'clinic',
  school: 'school',
};
const PLANT_BY_TOOL: Partial<Record<ToolName, PowerPlantKind>> = { coal: 'coal', wind: 'wind' };
/** L-path drag tools that lay linear utility runs. */
const LINE_TOOLS: ReadonlySet<ToolName> = new Set(['powerLine', 'pipe']);

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
  /** Power plant placement; anchor = top-left of the kind's footprint. */
  submitPlacePlant(kind: PowerPlantKind, anchor: Cell): void;
  /** Water pump placement (1x1; sim validates water adjacency). */
  submitPlacePump(anchor: Cell): void;
  submitPowerLine(a: Cell, b: Cell): void;
  submitPipe(a: Cell, b: Cell): void;
  /** Select-tool click; null = off-grid (clears any open inspection). */
  inspect(cell: Cell | null): void;
  showGhost(cells: Cell[], valid: boolean, zone?: ZoneType): void;
  clearGhost(): void;
  /** Effect-area preview (inclusive cell box) for click-place tools; hidden with clearGhost. */
  showRadius(minX: number, minY: number, maxX: number, maxY: number): void;
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
    const plant = PLANT_BY_TOOL[this.activeTool];
    if (plant) {
      this.host.submitPlacePlant(plant, cell);
      this.refreshGhost(cell);
      return;
    }
    if (this.activeTool === 'pump') {
      this.host.submitPlacePump(cell);
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
    else if (this.activeTool === 'powerLine') this.host.submitPowerLine(a, b);
    else if (this.activeTool === 'pipe') this.host.submitPipe(a, b);
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
  /**
   * Effect-area box for the hovered click-place tool. Services cover a
   * Chebyshev radius around the ANCHOR cell (matches sim markCoverage);
   * plants/pumps connect within the utility bridge radius of their footprint.
   */
  private showEffectArea(anchor: Cell): void {
    const service = SERVICE_BY_TOOL[this.activeTool];
    if (service) {
      const r = SERVICE_RADIUS[service];
      this.host.showRadius(anchor.x - r, anchor.y - r, anchor.x + r, anchor.y + r);
      return;
    }
    const size = this.footprintSize();
    const r = UTILITY_BRIDGE_RADIUS;
    this.host.showRadius(anchor.x - r, anchor.y - r, anchor.x + size - 1 + r, anchor.y + size - 1 + r);
  }

  /** Footprint side length for click-place tools (services, plants, pumps). */
  private footprintSize(): number {
    const plant = PLANT_BY_TOOL[this.activeTool];
    if (plant) return POWER_PLANT_FOOTPRINT[plant];
    if (this.activeTool === 'pump') return 1;
    return SERVICE_FOOTPRINT;
  }

  private isClickPlaceTool(): boolean {
    return (
      SERVICE_BY_TOOL[this.activeTool] !== undefined ||
      PLANT_BY_TOOL[this.activeTool] !== undefined ||
      this.activeTool === 'pump'
    );
  }

  private refreshGhost(current: Cell): void {
    if (this.isClickPlaceTool()) {
      const cells = this.footprintCells(current);
      this.host.showGhost(cells, this.isFootprintPlaceable(cells));
      this.showEffectArea(current);
      return;
    }
    const anchor = this.dragAnchor ?? current;
    const cells =
      this.activeTool === 'road' || LINE_TOOLS.has(this.activeTool)
        ? lPathCells(anchor, current)
        : rectCells(anchor, current);
    this.host.showGhost(cells, this.isSelectionValid(cells), ZONE_BY_TOOL[this.activeTool]);
  }

  /** In-bounds cells of the footprint square anchored (top-left) at the given cell. */
  private footprintCells(anchor: Cell): Cell[] {
    const size = this.footprintSize();
    const cells: Cell[] = [];
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const x = anchor.x + dx;
        const y = anchor.y + dy;
        if (x < this.host.gridWidth && y < this.host.gridHeight) cells.push({ x, y });
      }
    }
    return cells;
  }

  /** Full footprint in bounds and every cell free of water, roads, buildings, and structures. */
  private isFootprintPlaceable(cells: Cell[]): boolean {
    if (cells.length !== this.footprintSize() ** 2) return false;
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
      case 'powerLine':
      case 'pipe':
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
