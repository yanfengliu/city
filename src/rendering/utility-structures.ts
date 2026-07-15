import { Quaternion, Vector3 } from 'three';
import { cellHash01, WATER_SURFACE_Y, WATER_WIND_DIRECTION } from './constants';
import { colorOf, type GeometryBuilder } from './geometry-builder';
import {
  COAL_BOILER_COLOR,
  COAL_CONDENSER_COLOR,
  COAL_CONVEYOR_COLOR,
  COAL_DOOR_COLOR,
  COAL_HALL_COLOR,
  COAL_HALL_ROOF_COLOR,
  COAL_PILE_COLOR,
  COAL_RIB_COLOR,
  COAL_STACK_BAND_PROUD,
  COAL_STACK_COLOR,
  COAL_STACK_HEIGHT,
  COAL_STACK_RADIUS,
  COAL_STACK_SEGMENTS,
  COAL_STACK_STRIPE_RED,
  COAL_STACK_STRIPE_WHITE,
  COAL_STACK_TOP_RADIUS,
  PUMP_HOUSE_COLOR,
  PUMP_INTAKE_RADIUS,
  PUMP_INTAKE_REACH,
  PUMP_PIPE_COLOR,
  PUMP_ROOF_COLOR,
  PUMP_TANK_COLOR,
  PUMP_TUBE_SEGMENTS,
  PUMP_VALVE_COLOR,
  UTILITY_PAD_COLOR,
  UTILITY_PAD_LIFT,
  UTILITY_PAD_MARGIN,
  WIND_BLADE_COLOR,
  WIND_HUB_FORWARD,
  WIND_NACELLE_COLOR,
  WIND_NACELLE_HEIGHT,
  WIND_NACELLE_NOSE,
  WIND_NACELLE_TAIL,
  WIND_NACELLE_WIDTH,
  WIND_PAD_SIZE,
  WIND_ROTOR_RADIUS,
  WIND_ROTOR_SPEED,
  WIND_TOWER_BASE_RADIUS,
  WIND_TOWER_COLOR,
  WIND_TOWER_HEIGHT,
  WIND_TOWER_SEGMENTS,
  WIND_TOWER_TOP_RADIUS,
} from './utility-structure-style';
import type { TerrainSurfaceView } from './terrain-surface';

/** Semantic bounding box of one model feature, for contract tests. */
export interface StructurePart {
  kind: string;
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/** How deep pads bury below the lowest footprint corner (hidden on slopes). */
const PAD_BURY = 0.25;

const track = (
  builder: GeometryBuilder,
  parts: StructurePart[],
  kind: string,
  emit: () => void,
): void => {
  const start = builder.vertexCount;
  emit();
  const bounds = builder.boundsSince(start);
  parts.push({ kind, min: bounds.min, max: bounds.max });
};

/** Normalized prevailing wind (shared with the water waves) and its opposite. */
const WIND = new Vector3(WATER_WIND_DIRECTION.x, 0, WATER_WIND_DIRECTION.z).normalize();
const UPWIND = WIND.clone().negate();

/**
 * Coal plant: leveled pad carrying a turbine hall, boiler house, two banded
 * smokestacks, a ribbed condenser, and a coal pile feeding a conveyor gantry.
 * Laid out for the game's fixed 3×3 footprint, anchored at cell (x, y).
 */
export function addCoalPlant(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): StructurePart[] {
  const parts: StructurePart[] = [];
  const range = surface.footprintRange(x, y, w, h);
  const top = range.max + UTILITY_PAD_LIFT;
  const box = (
    kind: string,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    color: number,
  ): void => {
    track(builder, parts, kind, () =>
      builder.coloredBox(x + x0, y0, y + z0, x + x1, y1, y + z1, colorOf(color)),
    );
  };

  // The working yard (condenser, coal pile, conveyor) faces south — toward
  // the game's default camera — while the hall and boiler close the north edge.
  box('pad', UTILITY_PAD_MARGIN, UTILITY_PAD_MARGIN, w - UTILITY_PAD_MARGIN, h - UTILITY_PAD_MARGIN,
    range.min - PAD_BURY, top, UTILITY_PAD_COLOR);
  box('hall', 0.25, 0.25, 1.85, 1.45, top, top + 0.92, COAL_HALL_COLOR);
  box('hall-roof', 0.19, 0.19, 1.91, 1.51, top + 0.92, top + 1.04, COAL_HALL_ROOF_COLOR);
  box('hall-ridge', 0.35, 0.7, 1.75, 1.0, top + 1.04, top + 1.22, COAL_HALL_ROOF_COLOR);
  box('door', 0.93, 1.442, 1.17, 1.472, top, top + 0.5, COAL_DOOR_COLOR);
  box('boiler', 1.95, 0.25, 2.85, 1.25, top, top + 1.35, COAL_BOILER_COLOR);

  // Stacks straddle the conveyor's x = 2.35 run with clearance on both sides.
  for (const stackX of [2.1, 2.68]) {
    const cx = x + stackX;
    const cz = y + 1.68;
    track(builder, parts, 'stack', () =>
      builder.coloredTube(
        [cx, top, cz],
        [cx, top + COAL_STACK_HEIGHT, cz],
        COAL_STACK_RADIUS,
        COAL_STACK_TOP_RADIUS,
        COAL_STACK_SEGMENTS,
        COAL_STACK_COLOR,
      ),
    );
    // Bands follow the stack's taper at their height and sit slightly proud,
    // so retuning the stack radii or height in the style file cannot bury them.
    const stackRadiusAt = (y: number): number =>
      COAL_STACK_RADIUS + ((COAL_STACK_TOP_RADIUS - COAL_STACK_RADIUS) * y) / COAL_STACK_HEIGHT;
    const band = (kind: string, y0: number, y1: number, color: number): void => {
      const radius = stackRadiusAt((y0 + y1) / 2) + COAL_STACK_BAND_PROUD;
      track(builder, parts, kind, () =>
        builder.coloredTube(
          [cx, top + y0, cz],
          [cx, top + y1, cz],
          radius,
          radius,
          COAL_STACK_SEGMENTS,
          color,
        ),
      );
    };
    band('stack-band-white', COAL_STACK_HEIGHT - 0.34, COAL_STACK_HEIGHT - 0.22, COAL_STACK_STRIPE_WHITE);
    band('stack-band-red', COAL_STACK_HEIGHT - 0.22, COAL_STACK_HEIGHT - 0.1, COAL_STACK_STRIPE_RED);
  }

  box('condenser', 0.35, 1.95, 1.45, 2.65, top, top + 0.5, COAL_CONDENSER_COLOR);
  for (const ribZ of [2.07, 2.3, 2.53]) {
    box('condenser-rib', 0.42, ribZ - 0.05, 1.38, ribZ + 0.05, top + 0.5, top + 0.58, COAL_RIB_COLOR);
  }

  track(builder, parts, 'coal-pile', () =>
    builder.coloredTube(
      [x + 2.35, top, y + 2.28],
      [x + 2.35, top + 0.34, y + 2.28],
      0.42,
      0.05,
      7,
      COAL_PILE_COLOR,
    ),
  );
  track(builder, parts, 'conveyor', () =>
    builder.coloredBeam(
      [x + 2.35, top + 0.28, y + 2.28],
      [x + 2.35, top + 1.3, y + 1.2],
      [0, 1, 0],
      0.11,
      0.05,
      0.11,
      0.05,
      COAL_CONVEYOR_COLOR,
    ),
  );
  track(builder, parts, 'conveyor-strut', () =>
    builder.coloredTube(
      [x + 2.35, top, y + 1.75],
      [x + 2.35, top + 0.78, y + 1.75],
      0.025,
      0.025,
      4,
      COAL_CONVEYOR_COLOR,
    ),
  );
  return parts;
}

/**
 * Wind turbine mast: pad, tapered tower, and a nacelle yawed to face the
 * shared prevailing wind. The spinning rotor is a separate instanced mesh —
 * see buildWindRotor/windRotorHubPosition/windRotorAngle.
 */
export function addWindTurbine(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
): StructurePart[] {
  const parts: StructurePart[] = [];
  const range = surface.footprintRange(x, y, 1, 1);
  const top = range.max + UTILITY_PAD_LIFT;
  const cx = x + 0.5;
  const cz = y + 0.5;
  const half = WIND_PAD_SIZE / 2;

  track(builder, parts, 'pad', () =>
    builder.coloredBox(
      cx - half, range.min - PAD_BURY, cz - half,
      cx + half, top, cz + half,
      colorOf(UTILITY_PAD_COLOR),
    ),
  );
  track(builder, parts, 'tower', () =>
    builder.coloredTube(
      [cx, top, cz],
      [cx, top + WIND_TOWER_HEIGHT, cz],
      WIND_TOWER_BASE_RADIUS,
      WIND_TOWER_TOP_RADIUS,
      WIND_TOWER_SEGMENTS,
      WIND_TOWER_COLOR,
    ),
  );
  const hubY = top + WIND_TOWER_HEIGHT;
  track(builder, parts, 'nacelle', () =>
    builder.coloredBeam(
      [cx - UPWIND.x * WIND_NACELLE_TAIL, hubY, cz - UPWIND.z * WIND_NACELLE_TAIL],
      [cx + UPWIND.x * WIND_NACELLE_NOSE, hubY, cz + UPWIND.z * WIND_NACELLE_NOSE],
      [0, 1, 0],
      WIND_NACELLE_WIDTH,
      WIND_NACELLE_HEIGHT,
      WIND_NACELLE_WIDTH,
      WIND_NACELLE_HEIGHT,
      WIND_NACELLE_COLOR,
    ),
  );
  return parts;
}

/** World-space rotor hub for the turbine anchored at cell (x, y). */
export function windRotorHubPosition(
  surface: TerrainSurfaceView,
  x: number,
  y: number,
): { x: number; y: number; z: number } {
  const range = surface.footprintRange(x, y, 1, 1);
  return {
    x: x + 0.5 + UPWIND.x * WIND_HUB_FORWARD,
    y: range.max + UTILITY_PAD_LIFT + WIND_TOWER_HEIGHT,
    z: y + 0.5 + UPWIND.z * WIND_HUB_FORWARD,
  };
}

/** Rotates rotor-local +Z (its axis) to point upwind, matching the nacelle. */
export const WIND_FACING = new Quaternion().setFromUnitVectors(
  new Vector3(0, 0, 1),
  UPWIND.clone(),
);

/**
 * Presentation-only rotor angle: linear in the scene clock with a per-cell
 * phase so neighboring turbines never spin in lockstep. Never touches sim state.
 */
export function windRotorAngle(nowMs: number, cell: number): number {
  return WIND_ROTOR_SPEED * (nowMs / 1000) + cellHash01(cell) * Math.PI * 2;
}

/**
 * Rotor geometry in local space: spinner cone plus three tapered blades in
 * the XY plane, axis +Z, hub at the origin. Built once and instanced.
 */
export function buildWindRotor(builder: GeometryBuilder): StructurePart[] {
  const parts: StructurePart[] = [];
  track(builder, parts, 'spinner', () =>
    builder.coloredTube([0, 0, 0.02], [0, 0, 0.16], 0.085, 0.028, 8, WIND_NACELLE_COLOR),
  );
  for (let i = 0; i < 3; i++) {
    const theta = Math.PI / 2 + (i * Math.PI * 2) / 3;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    track(builder, parts, 'blade', () =>
      builder.coloredBeam(
        [dx * 0.05, dy * 0.05, 0.055],
        [dx * WIND_ROTOR_RADIUS, dy * WIND_ROTOR_RADIUS, 0.055],
        [0, 0, 1],
        0.085,
        0.028,
        0.03,
        0.012,
        WIND_BLADE_COLOR,
      ),
    );
  }
  return parts;
}

/** Orthogonal neighbors in intake-priority order: east, south, west, north. */
const PUMP_FACINGS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * Water pump: lakeside pump house with a blue roof and tank, plus an intake
 * pipe that reaches over the adjacent water cell (pumps are always placed
 * water-adjacent) and dips below the water surface.
 */
export function addWaterPump(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  gridWidth: number,
  gridHeight: number,
  cell: number,
  isWater: (cell: number) => boolean,
): StructurePart[] {
  const parts: StructurePart[] = [];
  const cellX = cell % gridWidth;
  const cellY = Math.floor(cell / gridWidth);
  const range = surface.footprintRange(cellX, cellY, 1, 1);
  const top = range.max + UTILITY_PAD_LIFT;
  const cx = cellX + 0.5;
  const cz = cellY + 0.5;

  let facing = PUMP_FACINGS[0];
  for (const [fx, fz] of PUMP_FACINGS) {
    const nx = cellX + fx;
    const ny = cellY + fz;
    if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
    if (isWater(ny * gridWidth + nx)) {
      facing = [fx, fz];
      break;
    }
  }
  const [fx, fz] = facing;
  const sx = -fz;
  const sz = fx;

  track(builder, parts, 'pad', () =>
    builder.coloredBox(cx - 0.41, range.min - PAD_BURY, cz - 0.41, cx + 0.41, top, cz + 0.41,
      colorOf(UTILITY_PAD_COLOR)),
  );
  track(builder, parts, 'house', () =>
    builder.coloredBeam(
      [cx - fx * 0.37, top + 0.23, cz - fz * 0.37],
      [cx + fx * 0.05, top + 0.23, cz + fz * 0.05],
      [0, 1, 0],
      0.5,
      0.46,
      0.5,
      0.46,
      PUMP_HOUSE_COLOR,
    ),
  );
  track(builder, parts, 'roof', () =>
    builder.coloredBeam(
      [cx - fx * 0.42, top + 0.495, cz - fz * 0.42],
      [cx + fx * 0.1, top + 0.495, cz + fz * 0.1],
      [0, 1, 0],
      0.5,
      0.07,
      0.5,
      0.07,
      PUMP_ROOF_COLOR,
    ),
  );
  // Storage silo stands clear of the roof, attached to the house's flank.
  const tankX = cx + sx * 0.36 - fx * 0.2;
  const tankZ = cz + sz * 0.36 - fz * 0.2;
  track(builder, parts, 'tank', () =>
    builder.coloredTube([tankX, top, tankZ], [tankX, top + 0.5, tankZ], 0.115, 0.115, 8,
      PUMP_TANK_COLOR),
  );
  track(builder, parts, 'tank-cap', () =>
    builder.coloredTube([tankX, top + 0.5, tankZ], [tankX, top + 0.62, tankZ], 0.115, 0.04, 8,
      PUMP_TANK_COLOR),
  );
  track(builder, parts, 'valve', () =>
    builder.coloredTube(
      [cx + fx * 0.05, top + 0.3, cz + fz * 0.05],
      [cx + fx * 0.085, top + 0.3, cz + fz * 0.085],
      0.05,
      0.05,
      PUMP_TUBE_SEGMENTS,
      PUMP_VALVE_COLOR,
    ),
  );
  // The intake leaves the house, dives over the bank, and dips underwater.
  const bendX = cx + fx * (0.5 + PUMP_INTAKE_REACH - 0.08);
  const bendZ = cz + fz * (0.5 + PUMP_INTAKE_REACH - 0.08);
  const tipX = cx + fx * (0.5 + PUMP_INTAKE_REACH);
  const tipZ = cz + fz * (0.5 + PUMP_INTAKE_REACH);
  track(builder, parts, 'intake', () => {
    builder.coloredTube(
      [cx + fx * 0.05, top + 0.16, cz + fz * 0.05],
      [bendX, WATER_SURFACE_Y + 0.16, bendZ],
      PUMP_INTAKE_RADIUS,
      PUMP_INTAKE_RADIUS,
      PUMP_TUBE_SEGMENTS,
      PUMP_PIPE_COLOR,
    );
    builder.coloredTube(
      [bendX, WATER_SURFACE_Y + 0.16, bendZ],
      [tipX, WATER_SURFACE_Y + 0.16, tipZ],
      PUMP_INTAKE_RADIUS,
      PUMP_INTAKE_RADIUS,
      PUMP_TUBE_SEGMENTS,
      PUMP_PIPE_COLOR,
    );
    builder.coloredTube(
      [tipX, WATER_SURFACE_Y + 0.16, tipZ],
      [tipX, WATER_SURFACE_Y - 0.05, tipZ],
      0.06,
      0.06,
      PUMP_TUBE_SEGMENTS,
      PUMP_PIPE_COLOR,
    );
  });
  return parts;
}
