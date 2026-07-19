import { colorOf, type GeometryBuilder } from './geometry-builder';
import {
  CLINIC_APRON_COLOR,
  CLINIC_CANOPY_COLOR,
  CLINIC_CROSS_COLOR,
  CLINIC_DOOR_COLOR,
  CLINIC_GLASS_COLOR,
  CLINIC_PARAPET_COLOR,
  CLINIC_PARAPET_RISE,
  CLINIC_POST_COLOR,
  CLINIC_WALL_COLOR,
  CLINIC_WALL_HEIGHT,
  FIRE_DOOR_COLOR,
  FIRE_DOOR_HEIGHT,
  FIRE_HALL_COLOR,
  FIRE_HALL_HEIGHT,
  FIRE_LIGHT_COLOR,
  FIRE_ROOF_COLOR,
  FIRE_ROOF_THICK,
  FIRE_TOWER_CAP_COLOR,
  FIRE_TOWER_CAP_RISE,
  FIRE_TOWER_COLOR,
  FIRE_TOWER_HEIGHT,
  FIRE_TRIM_COLOR,
  PARK_COLORS,
  PARK_LAYOUT,
  PARK_TREE_SPECIES,
  POLICE_ANTENNA_COLOR,
  POLICE_BASE_COLOR,
  POLICE_BASE_HEIGHT,
  POLICE_BEACON_COLOR,
  POLICE_CANOPY_COLOR,
  POLICE_DOOR_COLOR,
  POLICE_FENCE_COLOR,
  POLICE_POST_COLOR,
  POLICE_ROOF_COLOR,
  POLICE_ROOF_RISE,
  POLICE_SIGN_COLOR,
  POLICE_STEP_COLOR,
  POLICE_WALL_COLOR,
  POLICE_WALL_HEIGHT,
  SCHOOL_CLOCK_COLOR,
  SCHOOL_CLOCK_HUB_COLOR,
  SCHOOL_DOOR_COLOR,
  SCHOOL_FENCE_COLOR,
  SCHOOL_FLAG_COLOR,
  SCHOOL_FLAG_HEIGHT,
  SCHOOL_POLE_COLOR,
  SCHOOL_ROOF_COLOR,
  SCHOOL_ROOF_RISE,
  SCHOOL_WALL_COLOR,
  SCHOOL_WALL_HEIGHT,
  SCHOOL_WINDOW_COLOR,
  SCHOOL_YARD_COLOR,
  SERVICE_APRON_COLOR,
  SERVICE_PAD_BURY,
  SERVICE_PAD_COLOR,
  SERVICE_PAD_LIFT,
  SERVICE_PAD_MARGIN,
  SERVICE_POST_SEGMENTS,
} from './structure-style';
import { cellHash01, TREE_FOLIAGE_PALETTES } from './constants';
import type { ServiceKind } from './constants';
import type { StructurePart } from './utility-structures';
import type { TerrainSurfaceView } from './terrain-surface';

/** Footprint slice of the protocol StructureView these models consume. */
export interface ServiceStructureView {
  x: number;
  y: number;
  w: number;
  h: number;
  service: ServiceKind;
}

/**
 * Shared scaffolding for one service model: part-bounds tracking plus
 * footprint-fraction helpers. Layout offsets are fractions of the (2x2)
 * footprint so every part stays inside it by construction; heights and
 * slender radii are absolute world units.
 */
interface ModelFrame {
  parts: StructurePart[];
  /** Leveled pad top — every above-ground part builds up from here. */
  top: number;
  u(fx: number): number;
  v(fz: number): number;
  part(kind: string, emit: () => void): void;
  box(
    kind: string,
    fx0: number,
    fz0: number,
    fx1: number,
    fz1: number,
    y0: number,
    y1: number,
    color: number,
  ): void;
  /** Vertical frustum roof: eave footprint at y0 tapering to a ridge/cap at y1. */
  roof(
    kind: string,
    fx: number,
    fz: number,
    y0: number,
    y1: number,
    eaveX: number,
    eaveZ: number,
    topX: number,
    topZ: number,
    color: number,
  ): void;
  post(kind: string, fx: number, fz: number, y0: number, y1: number, r: number, color: number): void;
  /** Levelled base slab; the park overrides the civic concrete with lawn. */
  pad(color?: number): void;
}

function makeFrame(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): ModelFrame {
  const parts: StructurePart[] = [];
  const range = surface.footprintRange(x, y, w, h);
  const top = range.max + SERVICE_PAD_LIFT;
  const u = (fx: number): number => x + fx * w;
  const v = (fz: number): number => y + fz * h;
  const part = (kind: string, emit: () => void): void => {
    const start = builder.vertexCount;
    emit();
    const bounds = builder.boundsSince(start);
    parts.push({ kind, min: bounds.min, max: bounds.max });
  };
  const box: ModelFrame['box'] = (kind, fx0, fz0, fx1, fz1, y0, y1, color) => {
    part(kind, () => builder.coloredBox(u(fx0), y0, v(fz0), u(fx1), y1, v(fz1), colorOf(color)));
  };
  const roof: ModelFrame['roof'] = (kind, fx, fz, y0, y1, eaveX, eaveZ, topX, topZ, color) => {
    // Vertical beam with upHint +z: width tapers along x, thickness along z.
    part(kind, () =>
      builder.coloredBeam([u(fx), y0, v(fz)], [u(fx), y1, v(fz)], [0, 0, 1], eaveX, eaveZ, topX,
        topZ, color),
    );
  };
  const post: ModelFrame['post'] = (kind, fx, fz, y0, y1, r, color) => {
    part(kind, () =>
      builder.coloredTube([u(fx), y0, v(fz)], [u(fx), y1, v(fz)], r, r, SERVICE_POST_SEGMENTS,
        color),
    );
  };
  const pad: ModelFrame['pad'] = (color = SERVICE_PAD_COLOR) => {
    box('pad', SERVICE_PAD_MARGIN, SERVICE_PAD_MARGIN, 1 - SERVICE_PAD_MARGIN,
      1 - SERVICE_PAD_MARGIN, range.min - SERVICE_PAD_BURY, top, color);
  };
  return { parts, top, u, v, part, box, roof, post, pad };
}

/**
 * Fire station: cream drive-through garage hall whose two red roll-up bays
 * face south (+z, the default-camera/road side — the protocol carries no
 * road-adjacency data), an asphalt apron in front of the bays, and a slender
 * red hose/drill tower with a white band, pyramid cap, and warning light.
 */
export function addFireStation(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): StructurePart[] {
  const f = makeFrame(builder, surface, x, y, w, h);
  const { top } = f;
  f.pad();
  f.box('hall', 0.07, 0.12, 0.7, 0.6, top, top + FIRE_HALL_HEIGHT, FIRE_HALL_COLOR);
  f.box('hall-roof', 0.045, 0.095, 0.725, 0.625, top + FIRE_HALL_HEIGHT,
    top + FIRE_HALL_HEIGHT + FIRE_ROOF_THICK, FIRE_ROOF_COLOR);
  // Roll-up bays sit proud of the hall's south face, slats proud of the doors.
  for (const [x0, x1] of [
    [0.13, 0.34],
    [0.43, 0.64],
  ] as const) {
    f.box('bay-door', x0, 0.595, x1, 0.615, top + 0.02, top + 0.02 + FIRE_DOOR_HEIGHT,
      FIRE_DOOR_COLOR);
    for (const slatY of [0.16, 0.3]) {
      f.box('door-slat', x0 + 0.015, 0.595, x1 - 0.015, 0.617, top + slatY, top + slatY + 0.025,
        FIRE_TRIM_COLOR);
    }
  }
  f.box('apron', 0.1, 0.62, 0.67, 0.95, top, top + 0.012, SERVICE_APRON_COLOR);
  f.box('tower', 0.76, 0.14, 0.92, 0.32, top, top + FIRE_TOWER_HEIGHT, FIRE_TOWER_COLOR);
  f.box('tower-band', 0.75, 0.13, 0.93, 0.33, top + 1.06, top + 1.18, FIRE_TRIM_COLOR);
  const capTop = top + FIRE_TOWER_HEIGHT + FIRE_TOWER_CAP_RISE;
  f.roof('tower-cap', 0.84, 0.23, top + FIRE_TOWER_HEIGHT, capTop, 0.36, 0.4, 0.06, 0.06,
    FIRE_TOWER_CAP_COLOR);
  f.part('tower-light', () =>
    builder.coloredBox(f.u(0.84) - 0.028, capTop - 0.015, f.v(0.23) - 0.028, f.u(0.84) + 0.028,
      capTop + 0.075, f.v(0.23) + 0.028, colorOf(FIRE_LIGHT_COLOR)),
  );
  return f.parts;
}

/**
 * Police station: sturdy two-tone block (dark plinth, blue upper) under a
 * slate hip roof, entrance steps below a post canopy with a blue sign, a blue
 * beacon lamp beside the door, a rooftop antenna, and a fenced parking pad.
 */
export function addPoliceStation(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): StructurePart[] {
  const f = makeFrame(builder, surface, x, y, w, h);
  const { top } = f;
  f.pad();
  f.box('base', 0.08, 0.14, 0.66, 0.62, top, top + POLICE_BASE_HEIGHT, POLICE_BASE_COLOR);
  f.box('upper', 0.1, 0.16, 0.64, 0.6, top + POLICE_BASE_HEIGHT, top + POLICE_WALL_HEIGHT,
    POLICE_WALL_COLOR);
  f.roof('roof', 0.37, 0.38, top + POLICE_WALL_HEIGHT, top + POLICE_WALL_HEIGHT + POLICE_ROOF_RISE,
    1.16, 0.96, 0.52, 0.44, POLICE_ROOF_COLOR);
  // Steps tuck into the plinth and each other so no faces are coplanar.
  f.box('step', 0.29, 0.61, 0.45, 0.675, top, top + 0.1, POLICE_STEP_COLOR);
  f.box('step', 0.29, 0.665, 0.45, 0.73, top, top + 0.05, POLICE_STEP_COLOR);
  f.box('canopy', 0.26, 0.585, 0.48, 0.75, top + 0.52, top + 0.575, POLICE_CANOPY_COLOR);
  f.post('canopy-post', 0.285, 0.725, top, top + 0.53, 0.02, POLICE_POST_COLOR);
  f.post('canopy-post', 0.455, 0.725, top, top + 0.53, 0.02, POLICE_POST_COLOR);
  f.box('door', 0.325, 0.596, 0.415, 0.614, top + 0.02, top + 0.46, POLICE_DOOR_COLOR);
  f.box('sign', 0.27, 0.598, 0.47, 0.616, top + 0.62, top + 0.72, POLICE_SIGN_COLOR);
  f.post('lamp-post', 0.21, 0.7, top, top + 0.52, 0.016, POLICE_ROOF_COLOR);
  f.part('lamp', () =>
    builder.coloredBox(f.u(0.21) - 0.035, top + 0.52, f.v(0.7) - 0.035, f.u(0.21) + 0.035,
      top + 0.6, f.v(0.7) + 0.035, colorOf(POLICE_BEACON_COLOR)),
  );
  f.post('antenna', 0.55, 0.28, top + 1.08, top + 1.52, 0.01, POLICE_ANTENNA_COLOR);
  f.part('antenna-tip', () =>
    builder.coloredBox(f.u(0.55) - 0.022, top + 1.52, f.v(0.28) - 0.022, f.u(0.55) + 0.022,
      top + 1.565, f.v(0.28) + 0.022, colorOf(POLICE_BEACON_COLOR)),
  );
  f.box('parking', 0.7, 0.16, 0.94, 0.9, top, top + 0.012, SERVICE_APRON_COLOR);
  // Low barrier fence around the pad's outer edges; open toward the station.
  f.box('fence', 0.7, 0.148, 0.94, 0.16, top, top + 0.14, POLICE_FENCE_COLOR);
  f.box('fence', 0.934, 0.154, 0.946, 0.906, top, top + 0.14, POLICE_FENCE_COLOR);
  f.box('fence', 0.7, 0.9, 0.94, 0.912, top, top + 0.14, POLICE_FENCE_COLOR);
  return f.parts;
}

/**
 * Clinic: white block with a light parapet, a wide glazed ground floor, a
 * glass entrance canopy on posts, red crosses on both the facade and the
 * roof (for street and strategy cameras), and a marked ambulance pad.
 */
export function addClinic(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): StructurePart[] {
  const f = makeFrame(builder, surface, x, y, w, h);
  const { top } = f;
  const parapetTop = top + CLINIC_WALL_HEIGHT + CLINIC_PARAPET_RISE;
  f.pad();
  f.box('body', 0.08, 0.12, 0.7, 0.64, top, top + CLINIC_WALL_HEIGHT, CLINIC_WALL_COLOR);
  f.box('parapet', 0.065, 0.105, 0.715, 0.655, top + CLINIC_WALL_HEIGHT, parapetTop,
    CLINIC_PARAPET_COLOR);
  f.box('glazing', 0.12, 0.634, 0.66, 0.652, top + 0.1, top + 0.42, CLINIC_GLASS_COLOR);
  f.box('canopy', 0.27, 0.62, 0.55, 0.79, top + 0.5, top + 0.545, CLINIC_CANOPY_COLOR);
  f.post('canopy-post', 0.295, 0.765, top, top + 0.51, 0.02, CLINIC_POST_COLOR);
  f.post('canopy-post', 0.525, 0.765, top, top + 0.51, 0.02, CLINIC_POST_COLOR);
  f.box('door', 0.36, 0.6415, 0.46, 0.6555, top + 0.02, top + 0.44, CLINIC_DOOR_COLOR);
  f.box('cross-v', 0.365, 0.636, 0.415, 0.654, top + 0.54, top + 0.86, CLINIC_CROSS_COLOR);
  f.box('cross-h', 0.31, 0.638, 0.47, 0.656, top + 0.645, top + 0.755, CLINIC_CROSS_COLOR);
  f.box('roof-cross-v', 0.375, 0.24, 0.405, 0.52, parapetTop, parapetTop + 0.014,
    CLINIC_CROSS_COLOR);
  f.box('roof-cross-h', 0.3, 0.345, 0.48, 0.415, parapetTop, parapetTop + 0.022,
    CLINIC_CROSS_COLOR);
  f.box('ambulance-pad', 0.74, 0.46, 0.94, 0.92, top, top + 0.01, CLINIC_APRON_COLOR);
  f.box('pad-cross-v', 0.826, 0.56, 0.854, 0.82, top, top + 0.018, CLINIC_CROSS_COLOR);
  f.box('pad-cross-h', 0.77, 0.655, 0.91, 0.725, top, top + 0.024, CLINIC_CROSS_COLOR);
  return f.parts;
}

/**
 * School: two warm-yellow gabled wings joined in an L, big white window
 * panels, a flagpole flying a red flag, a clock on the east gable end, and a
 * sandy fenced play-yard tucked into the L.
 */
export function addSchool(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): StructurePart[] {
  const f = makeFrame(builder, surface, x, y, w, h);
  const { top } = f;
  const wallTop = top + SCHOOL_WALL_HEIGHT;
  f.pad();
  f.box('wing-a', 0.08, 0.1, 0.92, 0.38, top, wallTop, SCHOOL_WALL_COLOR);
  // Wing B tucks 0.02 into wing A so the shared seam stays interior.
  f.box('wing-b', 0.08, 0.36, 0.36, 0.8, top, wallTop, SCHOOL_WALL_COLOR);
  f.roof('roof-a', 0.5, 0.24, wallTop, wallTop + SCHOOL_ROOF_RISE, 1.78, 0.66, 1.7, 0.05,
    SCHOOL_ROOF_COLOR);
  f.roof('roof-b', 0.22, 0.58, wallTop, wallTop + SCHOOL_ROOF_RISE, 0.66, 0.98, 0.05, 0.9,
    SCHOOL_ROOF_COLOR);
  for (const wx of [0.46, 0.62, 0.78]) {
    f.box('window', wx, 0.374, wx + 0.1, 0.392, top + 0.2, top + 0.52, SCHOOL_WINDOW_COLOR);
  }
  for (const wz of [0.46, 0.63]) {
    f.box('window', 0.354, wz, 0.372, wz + 0.1, top + 0.2, top + 0.52, SCHOOL_WINDOW_COLOR);
  }
  f.box('door', 0.16, 0.794, 0.27, 0.812, top + 0.02, top + 0.5, SCHOOL_DOOR_COLOR);
  f.part('clock-face', () =>
    builder.coloredTube([f.u(0.92) - 0.01, top + 0.555, f.v(0.24)],
      [f.u(0.92) + 0.028, top + 0.555, f.v(0.24)], 0.06, 0.06, 8, SCHOOL_CLOCK_COLOR),
  );
  f.part('clock-hub', () =>
    builder.coloredTube([f.u(0.92) + 0.028, top + 0.555, f.v(0.24)],
      [f.u(0.92) + 0.042, top + 0.555, f.v(0.24)], 0.016, 0.016, SERVICE_POST_SEGMENTS,
      SCHOOL_CLOCK_HUB_COLOR),
  );
  f.post('flag-pole', 0.46, 0.5, top, top + SCHOOL_FLAG_HEIGHT, 0.013, SCHOOL_POLE_COLOR);
  f.part('flag', () =>
    builder.coloredBox(f.u(0.46) + 0.013, top + 1.26, f.v(0.5) - 0.006, f.u(0.46) + 0.193,
      top + 1.36, f.v(0.5) + 0.006, colorOf(SCHOOL_FLAG_COLOR)),
  );
  f.box('yard', 0.42, 0.46, 0.92, 0.9, top, top + 0.01, SCHOOL_YARD_COLOR);
  // Fence walls overlap the yard edge and each other so no faces are coplanar.
  f.box('fence', 0.408, 0.46, 0.426, 0.906, top, top + 0.13, SCHOOL_FENCE_COLOR);
  f.box('fence', 0.914, 0.46, 0.932, 0.906, top, top + 0.13, SCHOOL_FENCE_COLOR);
  f.box('fence', 0.414, 0.894, 0.926, 0.912, top, top + 0.13, SCHOOL_FENCE_COLOR);
  return f.parts;
}

// Every park visual is a salted draw off one seed, as with the decorative
// terrain trees, so rebuilding a park never rerolls its grove.
const PARK_HASH = {
  anchorX: 0x9e3779b1, anchorZ: 0x85ebca6b, slotStride: 0x01000193,
  species: 0x27d4eb2d, palette: 0x165667b1, height: 0x94d049bb,
  jitterX: 0x369dea0f, jitterZ: 0xdb4f0b91, flower: 0x7f4a7c15,
} as const;

/** A park's identity is its footprint anchor, which outlives save/load and
 * entity-id reuse — so the grove a player learns is the grove that comes back. */
const parkSeed = (x: number, y: number): number =>
  (Math.imul((x + 1) | 0, PARK_HASH.anchorX) ^ Math.imul((y + 1) | 0, PARK_HASH.anchorZ)) | 0;

/** Uniform draw in [0, 1) for one salted axis of one slot inside a park. */
const parkDraw = (seed: number, salt: number, slot: number): number =>
  cellHash01(seed + salt + Math.imul(slot, PARK_HASH.slotStride));

/**
 * Park: two cells of open ground — a mown lawn under gravel paths crossing at a
 * fountain plaza, a grove whose species, palette, height, and exact spot are
 * hashed from the anchor cell, a stone-rimmed pond, benches, lamps, flower beds.
 *
 * No walls and no roof, by design: the largest single part is a tree canopy, a
 * fraction of the solid block every other service raises, so a park never reads
 * as a building. Slender verticals over flat ground also keep the silhouette
 * alive when a coverage overlay flattens the vertex colours and leaves Lambert
 * shading to work alone.
 */
export function addPark(
  builder: GeometryBuilder, surface: TerrainSurfaceView,
  x: number, y: number, w: number, h: number,
): StructurePart[] {
  const f = makeFrame(builder, surface, x, y, w, h);
  const { top } = f;
  const seed = parkSeed(x, y);
  const L = PARK_LAYOUT;
  const C = PARK_COLORS;
  const { bench, fountain, lamp, pond, tree } = L;
  /** Vertical low-poly frustum centered on a footprint point. */
  const disc = (fx: number, fz: number, y0: number, y1: number, r0: number, r1: number,
    segments: number, color: number): void =>
    builder.coloredTube([f.u(fx), y0, f.v(fz)], [f.u(fx), y1, f.v(fz)], r0, r1, segments, color);
  const pick = <T>(items: readonly T[], salt: number, slot: number): T =>
    items[Math.min(items.length - 1, Math.floor(parkDraw(seed, salt, slot) * items.length))];

  // Ground layers stack by lift so overlapping flat decals are never coplanar.
  f.pad(C.lawn);
  for (const fz of L.mowStripes) {
    f.box('mow-stripe', L.pathInset, fz - L.mowHalfWidth, 1 - L.pathInset, fz + L.mowHalfWidth,
      top, top + L.mowLift, C.mow);
  }
  f.box('path', 0.5 - L.pathHalfWidth, L.pathInset, 0.5 + L.pathHalfWidth, 1 - L.pathInset,
    top, top + L.pathNorthSouthLift, C.path);
  f.box('path', L.pathInset, 0.5 - L.pathHalfWidth, 1 - L.pathInset, 0.5 + L.pathHalfWidth,
    top, top + L.pathEastWestLift, C.path);
  f.part('plaza', () =>
    disc(0.5, 0.5, top, top + L.plazaLift, L.plazaRadius, L.plazaRadius, L.discSegments, C.plaza));

  f.part('fountain-basin', () => {
    disc(0.5, 0.5, top + L.plazaLift, top + fountain.basinTop, fountain.basinRadius,
      fountain.basinRadius, fountain.segments, C.stone);
    disc(0.5, 0.5, top + fountain.basinTop, top + fountain.waterTop, fountain.waterRadius,
      fountain.waterRadius, fountain.segments, C.water);
  });
  f.part('fountain-jet', () =>
    disc(0.5, 0.5, top + fountain.waterTop, top + fountain.jetTop, fountain.jetRadius,
      fountain.jetTopRadius, fountain.segments, C.water));

  // A formal basin: the water sits on a stone rim rather than sinking below the
  // pad, which would break the leveled-pad contract every service shares.
  f.part('pond', () => {
    disc(pond.fx, pond.fz, top, top + pond.rimTop, pond.rimRadius, pond.rimRadius, L.discSegments,
      C.stone);
    disc(pond.fx, pond.fz, top + pond.rimTop, top + pond.waterTop, pond.waterRadius,
      pond.waterRadius, L.discSegments, C.water);
  });

  L.treeSlots.forEach((slot, index) => {
    const species = pick(PARK_TREE_SPECIES, PARK_HASH.species, index);
    const palette = pick(TREE_FOLIAGE_PALETTES, PARK_HASH.palette, index);
    const grow = parkDraw(seed, PARK_HASH.height, index) * tree.heightScaleRange;
    const scale = tree.heightScaleMin + grow;
    const cx = f.u(slot.fx) + (parkDraw(seed, PARK_HASH.jitterX, index) - 0.5) * 2 * tree.jitter;
    const cz = f.v(slot.fz) + (parkDraw(seed, PARK_HASH.jitterZ, index) - 0.5) * 2 * tree.jitter;
    f.part('tree', () => {
      builder.coloredTube([cx, top, cz], [cx, top + species.trunkTop * scale, cz],
        species.trunkRadius, species.trunkRadius, tree.trunkSegments, palette.trunk);
      species.canopy.forEach((layer, tier) => {
        builder.coloredTube([cx, top + layer.bottom * scale, cz], [cx, top + layer.top * scale, cz],
          layer.r0, layer.r1, tree.canopySegments, tier === 0 ? palette.lower : palette.upper);
      });
    });
  });

  for (const seat of L.benches) {
    const hx = seat.alongX ? bench.halfLength : bench.halfDepth;
    const hz = seat.alongX ? bench.halfDepth : bench.halfLength;
    const cx = f.u(seat.fx);
    const cz = f.v(seat.fz);
    f.part('bench', () => {
      builder.coloredBox(cx - hx, top + bench.seatBottom, cz - hz, cx + hx, top + bench.seatTop,
        cz + hz, colorOf(C.benchSeat));
      // Backrest stands on the seat's far long edge, inside the seat's own box.
      const backX = seat.alongX ? cx - hx : cx + hx - bench.backThick;
      const backZ = seat.alongX ? cz + hz - bench.backThick : cz - hz;
      builder.coloredBox(backX, top + bench.seatTop, backZ,
        backX + (seat.alongX ? hx * 2 : bench.backThick), top + bench.backTop,
        backZ + (seat.alongX ? bench.backThick : hz * 2), colorOf(C.benchSeat));
      for (const end of [-1, 1]) {
        const reach = end * (bench.halfLength - bench.legInset);
        const legX = seat.alongX ? cx + reach : cx;
        const legZ = seat.alongX ? cz : cz + reach;
        builder.coloredBox(legX - bench.legHalf, top, legZ - bench.legHalf, legX + bench.legHalf,
          top + bench.seatBottom, legZ + bench.legHalf, colorOf(C.benchLeg));
      }
    });
  }

  for (const post of L.lamps) {
    f.part('lamp', () => {
      disc(post.fx, post.fz, top, top + lamp.postTop, lamp.postRadius, lamp.postRadius,
        SERVICE_POST_SEGMENTS, C.lampPost);
      disc(post.fx, post.fz, top + lamp.globeBottom, top + lamp.globeTop, lamp.globeRadius,
        lamp.globeRadius, SERVICE_POST_SEGMENTS, C.lampGlobe);
    });
  }

  L.flowerBeds.forEach((bed, index) => {
    f.box('flower-bed', bed.fx - L.flowerBed.half / w, bed.fz - L.flowerBed.half / h,
      bed.fx + L.flowerBed.half / w, bed.fz + L.flowerBed.half / h, top, top + L.flowerBed.top,
      pick(C.flowers, PARK_HASH.flower, index));
  });
  return f.parts;
}

/** Builds the model for one structure view; exhaustive over ServiceKind. */
export function addServiceStructure(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  view: ServiceStructureView,
): StructurePart[] {
  switch (view.service) {
    case 'fireStation':
      return addFireStation(builder, surface, view.x, view.y, view.w, view.h);
    case 'police':
      return addPoliceStation(builder, surface, view.x, view.y, view.w, view.h);
    case 'clinic':
      return addClinic(builder, surface, view.x, view.y, view.w, view.h);
    case 'school':
      return addSchool(builder, surface, view.x, view.y, view.w, view.h);
    case 'park':
      return addPark(builder, surface, view.x, view.y, view.w, view.h);
    default: {
      const unhandled: never = view.service;
      throw new Error(`unhandled service kind: ${String(unhandled)}`);
    }
  }
}
