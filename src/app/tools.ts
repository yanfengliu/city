import { SERVICE_FOOTPRINT, SERVICE_RADIUS } from '../sim/constants/services';
import { POWER_PLANT_FOOTPRINT, UTILITY_BRIDGE_RADIUS } from '../sim/constants/utilities';
import { ZONE_MAX_ROAD_DISTANCE } from '../sim/constants/zoning';
import { cellIndex, lPathCells, type Cell } from '../sim/grid';
import type { PowerPlantKind, ServiceType, ZoneType } from '../sim/types';
import type { EntityRef } from '../protocol/messages';

/** Household incarnation plus the stable member currently visible as a walker. */
export interface PersonSelection extends EntityRef {
  memberId: number;
}

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
  | 'park'
  | 'garden'
  | 'coal'
  | 'wind'
  | 'powerLine'
  | 'pump'
  | 'pipe';

/**
 * Toolbar layout: [Select] | [Road, Bulldoze, Dezone] | [Zone R, C, I] |
 * [services x6] | [utilities x5]. Each tool has a single-key shortcut (shown
 * as a badge on its button). W/A/S/D are reserved for camera panning, so the
 * tools avoid them: R/C/I are the zones (classic mnemonic), Road takes Q,
 * Select V, Wind K, and the rest fall to nearby unused letters.
 */
export const TOOL_GROUPS: { id: ToolName; label: string; title: string; key: string }[][] = [
  [{ id: 'select', label: 'Select', key: 'v', title: 'Click buildings or pedestrians for details; left-drag or WASD pans the camera' }],
  [
    { id: 'road', label: 'Road', key: 'q', title: 'Drag to draw a road ($10/cell; $40 over water as a bridge). Buildings grow along roads; traffic drives on them' },
    { id: 'bulldoze', label: 'Bulldoze', key: 'b', title: 'Drag a rectangle to demolish roads, buildings, services, and utilities (25% road refund)' },
    { id: 'dezone', label: 'Dezone', key: 'x', title: 'Drag a rectangle to erase zoning before painting a different zone (does not touch grown buildings)' },
  ],
  [
    { id: 'zoneR', label: 'Zone R', key: 'r', title: 'Residential: homes grow here when demand is green. Paint within 2 cells of a road; Dezone existing cells first' },
    { id: 'zoneC', label: 'Zone C', key: 'c', title: 'Commercial: shops with jobs. Paint within 2 cells of a road; Dezone existing cells first' },
    { id: 'zoneI', label: 'Zone I', key: 'i', title: 'Industrial: jobs, but pollutes. Paint near roads and away from homes; Dezone existing cells first' },
  ],
  [
    { id: 'fire', label: 'Fire', key: 'f', title: 'Fire station ($400): raises land value within 24 cells' },
    { id: 'police', label: 'Police', key: 'p', title: 'Police station ($400): raises land value within 24 cells' },
    { id: 'clinic', label: 'Clinic', key: 'h', title: 'Clinic ($500): raises land value within 32 cells' },
    { id: 'school', label: 'School', key: 'e', title: 'School ($500): raises land value within 32 cells and lets buildings reach level 3' },
    { id: 'park', label: 'Park 🌳', key: 'n', title: 'Park ($150): cheap green space that raises land value within 10 cells. Residents walk here on an evening out, so dot several through a neighbourhood' },
    { id: 'garden', label: 'Garden 🌻', key: 'm', title: 'Community garden ($90): compact green space that raises land value within 6 cells. Adults and seniors favour gardens for nearby leisure' },
  ],
  [
    { id: 'coal', label: 'Coal ⚡', key: 'g', title: `Coal plant ($800, 3x3): powers 400 units but pollutes. Only the plant and its Lines carry power — buildings within ${UTILITY_BRIDGE_RADIUS} cells of them are served, and never pass it on` },
    { id: 'wind', label: 'Wind ⚡', key: 'k', title: `Wind turbine ($300, 1x1): clean but small (40 units). Same ${UTILITY_BRIDGE_RADIUS}-cell connection rule` },
    { id: 'powerLine', label: 'Line', key: 'l', title: `Power line ($4/cell): takes no space and may cross roads/buildings. Must START on the plant or an existing line — a line laid across a gap carries nothing. Buildings within ${UTILITY_BRIDGE_RADIUS} cells of it are served` },
    { id: 'pump', label: 'Pump 💧', key: 'u', title: 'Water pump ($500): place on land RIGHT NEXT to water. Supplies 300 units through Pipes' },
    { id: 'pipe', label: 'Pipe', key: 'j', title: `Water pipe ($3/new cell): runs underground across land, roads, buildings, and lakes. Anything within ${UTILITY_BRIDGE_RADIUS} cells of a pump-connected pipe gets water` },
  ],
];

const ZONE_BY_TOOL: Partial<Record<ToolName, ZoneType>> = { zoneR: 'R', zoneC: 'C', zoneI: 'I' };
const SERVICE_BY_TOOL: Partial<Record<ToolName, ServiceType>> = {
  fire: 'fireStation',
  police: 'police',
  clinic: 'clinic',
  school: 'school',
  park: 'park',
  garden: 'garden',
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
  /** Power plant or water pump footprint (occupies like a building). */
  hasUtilityFootprint(index: number): boolean;
  /** Power line cell (a thin overhead overlay; only relevant to bulldoze). */
  hasPowerLine(index: number): boolean;
  /** Water pipe cell (underground; only relevant to bulldoze). */
  hasPipe(index: number): boolean;
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
  /** Select-tool click that landed on a walking household. */
  inspectPerson(citizen: PersonSelection): void;
  /** validity: one flag for all-or-nothing commands; per-cell for subset painters (zone/dezone). */
  showGhost(cells: Cell[], validity: boolean | boolean[], zone?: ZoneType): void;
  clearGhost(): void;
  /** Effect-area preview (inclusive cell box) for click-place tools; hidden with clearGhost. */
  showRadius(minX: number, minY: number, maxX: number, maxY: number): void;
  /** Player-facing explanation for a blocked placement (toast). */
  notify(message: string): void;
  onToolChanged(tool: ToolName): void;
}

/** Semantic pipe ghost retained after pointer-up for headless playtest evidence. */
export interface PipePreviewState {
  active: boolean;
  submitted: boolean;
  from: Cell;
  to: Cell;
  selectedCellCount: number;
  newCellCount: number;
  waterCellCount: number;
  valid: boolean;
  rejectionReason: string | null;
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
  private retainedPipePreview: PipePreviewState | null = null;

  constructor(private readonly host: ToolHost) {}

  /** Every tool except select owns left-drag (select leaves it to camera pan). */
  get isBuildTool(): boolean {
    return this.activeTool !== 'select';
  }

  get dragging(): boolean {
    return this.dragAnchor !== null;
  }

  get pipePreview(): PipePreviewState | null {
    return this.retainedPipePreview;
  }

  setTool(tool: ToolName): void {
    if (tool === this.activeTool) return;
    this.dragAnchor = null;
    this.retainedPipePreview = null;
    this.activeTool = tool;
    this.host.clearGhost();
    this.host.onToolChanged(tool);
  }

  pointerDown(cell: Cell | null): void {
    if (!this.isBuildTool || !cell) return;
    if (this.isClickPlaceTool()) {
      // Explain the problem instead of a silent sim rejection.
      const problem = this.footprintProblem(this.footprintCells(cell));
      if (problem) {
        this.host.notify(problem);
        this.refreshGhost(cell);
        return;
      }
      const service = SERVICE_BY_TOOL[this.activeTool];
      const plant = PLANT_BY_TOOL[this.activeTool];
      if (service) this.host.submitPlaceService(service, cell);
      else if (plant) this.host.submitPlacePlant(plant, cell);
      else this.host.submitPlacePump(cell);
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
      if (this.retainedPipePreview?.submitted === false) this.retainedPipePreview = null;
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
    else if (this.activeTool === 'pipe') {
      this.retainedPipePreview = this.describePipePreview(a, b, lPathCells(a, b), false, true);
      this.host.submitPipe(a, b);
    }
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

  /** Select-tool click that landed on a person rather than the ground. */
  selectPerson(citizen: PersonSelection): void {
    if (this.activeTool !== 'select') return;
    this.host.inspectPerson(citizen);
  }

  cancelDrag(): void {
    if (!this.dragAnchor) return;
    this.dragAnchor = null;
    this.retainedPipePreview = null;
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
    if (this.activeTool === 'pipe') {
      const preview = this.describePipePreview(
        anchor,
        current,
        cells,
        this.dragAnchor !== null,
        false,
      );
      this.retainedPipePreview = preview;
      this.host.showGhost(cells, preview.valid);
      return;
    }
    // Zone/dezone paint only their eligible subset — tint each cell honestly.
    const zone = ZONE_BY_TOOL[this.activeTool];
    if (zone) {
      this.host.showGhost(cells, cells.map((cell) => this.isZoneable(cell)), zone);
      return;
    }
    if (this.activeTool === 'dezone') {
      this.host.showGhost(
        cells,
        cells.map((cell) => this.isDezoneable(cell)),
      );
      return;
    }
    this.host.showGhost(cells, this.isSelectionValid(cells));
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

  /** Full footprint in bounds and free of water, roads, and other special structures. */
  private isFootprintPlaceable(cells: Cell[]): boolean {
    return this.footprintProblem(cells) === null;
  }

  /**
   * Why the hovered footprint can't be placed (null = placeable). Mirrors the
   * sim validators so the ghost is honest and rejections are explainable.
   */
  footprintProblem(cells: Cell[]): string | null {
    if (cells.length !== this.footprintSize() ** 2) return 'Too close to the map edge';
    for (const cell of cells) {
      const index = cellIndex(cell.x, cell.y, this.host.gridWidth);
      if (this.host.isWater(cell.x, cell.y)) return 'Cannot build on water';
      if (this.host.hasRoad(index)) return 'A road is in the way';
      // Growable R/C/I buildings are replaced automatically by special stamps.
      if (this.host.hasStructure(index)) {
        return 'A service building is in the way — bulldoze first';
      }
      if (this.host.hasUtilityFootprint(index)) {
        return 'A plant or pump is in the way — bulldoze first';
      }
      // A power line is a thin overhead overlay — it never blocks a stamp.
    }
    if (SERVICE_BY_TOOL[this.activeTool]) {
      const touchesRoad = cells.some((cell) =>
        this.neighbors4(cell).some((n) => this.host.hasRoad(cellIndex(n.x, n.y, this.host.gridWidth))),
      );
      if (!touchesRoad) return 'A service must touch a road';
    }
    if (this.activeTool === 'pump') {
      const touchesWater = cells.some((cell) =>
        this.neighbors4(cell).some((n) => this.host.isWater(n.x, n.y)),
      );
      if (!touchesWater) return 'A pump must be placed on land right next to water';
    }
    return null;
  }

  private neighbors4(cell: Cell): Cell[] {
    return [
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 },
    ].filter((n) => n.x >= 0 && n.y >= 0 && n.x < this.host.gridWidth && n.y < this.host.gridHeight);
  }

  /**
   * Mirrors the sim validators so ghosts stay honest. Road: builds over water
   * as a bridge and crosses power lines; anything else occupying a cell
   * (buildings, services, plants, pumps) blocks. A power line runs over
   * everything on land but water blocks it; an underground pipe may also cross
   * water. Bulldoze:
   * needs ≥1 demolishable cell (road, building, structure, plant/pump, line,
   * or pipe). Dezone: needs ≥1 zoned cell. Zone: needs ≥1 unzoned, zoneable
   * cell (land, non-road, within ZONE_MAX_ROAD_DISTANCE of a road).
   */
  private isSelectionValid(cells: Cell[]): boolean {
    const index = (cell: Cell): number => cellIndex(cell.x, cell.y, this.host.gridWidth);
    switch (this.activeTool) {
      case 'road':
        return !cells.some((cell) => this.hasOccupyingEntity(cell));
      case 'powerLine':
        // A line is a thin overhead overlay (like a pipe): it runs over
        // everything on land and only water blocks it.
        return !cells.some((cell) => this.host.isWater(cell.x, cell.y));
      case 'pipe':
        return cells.some((cell) => !this.host.hasPipe(index(cell)));
      case 'bulldoze':
        return cells.some(
          (cell) =>
            this.host.hasRoad(index(cell)) ||
            this.host.hasBuilding(index(cell)) ||
            this.host.hasStructure(index(cell)) ||
            this.host.hasUtilityFootprint(index(cell)) ||
            this.host.hasPowerLine(index(cell)) ||
            this.host.hasPipe(index(cell)),
        );
      case 'dezone':
        return cells.some((cell) => this.isDezoneable(cell));
      case 'zoneR':
      case 'zoneC':
      case 'zoneI':
        return cells.some((cell) => this.isZoneable(cell));
      default:
        return true;
    }
  }

  private hasOccupyingEntity(cell: Cell): boolean {
    const index = cellIndex(cell.x, cell.y, this.host.gridWidth);
    return (
      this.host.hasBuilding(index) ||
      this.host.hasStructure(index) ||
      this.host.hasUtilityFootprint(index)
    );
  }

  private describePipePreview(
    from: Cell,
    to: Cell,
    cells: Cell[],
    active: boolean,
    submitted: boolean,
  ): PipePreviewState {
    const indices = cells.map((cell) => cellIndex(cell.x, cell.y, this.host.gridWidth));
    const newCellCount = indices.filter((index) => !this.host.hasPipe(index)).length;
    return {
      active,
      submitted,
      from,
      to,
      selectedCellCount: cells.length,
      newCellCount,
      waterCellCount: cells.filter((cell) => this.host.isWater(cell.x, cell.y)).length,
      valid: newCellCount > 0,
      rejectionReason: newCellCount === 0 ? 'All selected cells already have pipes' : null,
    };
  }

  private isDezoneable(cell: Cell): boolean {
    const index = cellIndex(cell.x, cell.y, this.host.gridWidth);
    return this.host.hasZone(index) && !this.hasOccupyingEntity(cell);
  }

  private isZoneable(cell: Cell): boolean {
    if (this.host.isWater(cell.x, cell.y)) return false;
    const index = cellIndex(cell.x, cell.y, this.host.gridWidth);
    if (this.host.hasRoad(index) || this.host.hasZone(index)) return false;
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
