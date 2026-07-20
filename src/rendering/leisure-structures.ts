import { cellHash01, TREE_FOLIAGE_PALETTES } from './constants';
import { colorOf, type GeometryBuilder } from './geometry-builder';
import { makeServiceModelFrame } from './service-model-frame';
import {
  GARDEN_COLORS,
  GARDEN_LAYOUT,
  PARK_COLORS,
  PARK_LAYOUT,
  PARK_TREE_SPECIES,
  SERVICE_POST_SEGMENTS,
} from './structure-style';
import type { TerrainSurfaceView } from './terrain-surface';
import type { StructurePart } from './utility-structures';

// Every park visual is a salted draw off one seed, as with the decorative
// terrain trees, so rebuilding a park never rerolls its grove.
const PARK_HASH = {
  anchorX: 0x9e3779b1, anchorZ: 0x85ebca6b, slotStride: 0x01000193,
  species: 0x27d4eb2d, palette: 0x165667b1, height: 0x94d049bb,
  jitterX: 0x369dea0f, jitterZ: 0xdb4f0b91, flower: 0x7f4a7c15,
} as const;

/** A park's identity is its footprint anchor, which outlives save/load and entity-id reuse. */
const parkSeed = (x: number, y: number): number =>
  (Math.imul((x + 1) | 0, PARK_HASH.anchorX) ^ Math.imul((y + 1) | 0, PARK_HASH.anchorZ)) | 0;

/** Uniform draw in [0, 1) for one salted axis of one slot inside a park. */
const parkDraw = (seed: number, salt: number, slot: number): number =>
  cellHash01(seed + salt + Math.imul(slot, PARK_HASH.slotStride));

/**
 * Park: a mown lawn under crossing gravel paths, a fountain plaza, a hashed
 * grove, stone-rimmed pond, benches, lamps, and flower beds. Its open, varied
 * silhouette remains readable when a coverage overlay flat-tints the model.
 */
export function addPark(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): StructurePart[] {
  const f = makeServiceModelFrame(builder, surface, x, y, w, h);
  const { top } = f;
  const seed = parkSeed(x, y);
  const L = PARK_LAYOUT;
  const C = PARK_COLORS;
  const { bench, fountain, lamp, pond, tree } = L;
  const disc = (
    fx: number,
    fz: number,
    y0: number,
    y1: number,
    r0: number,
    r1: number,
    segments: number,
    color: number,
  ): void =>
    builder.coloredTube([f.u(fx), y0, f.v(fz)], [f.u(fx), y1, f.v(fz)], r0, r1, segments, color);
  const pick = <T>(items: readonly T[], salt: number, slot: number): T =>
    items[Math.min(items.length - 1, Math.floor(parkDraw(seed, salt, slot) * items.length))];

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
  f.part('pond', () => {
    disc(pond.fx, pond.fz, top, top + pond.rimTop, pond.rimRadius, pond.rimRadius, L.discSegments,
      C.stone);
    disc(pond.fx, pond.fz, top + pond.rimTop, top + pond.waterTop, pond.waterRadius,
      pond.waterRadius, L.discSegments, C.water);
  });

  L.treeSlots.forEach((slot, index) => {
    const species = pick(PARK_TREE_SPECIES, PARK_HASH.species, index);
    const palette = pick(TREE_FOLIAGE_PALETTES, PARK_HASH.palette, index);
    const scale = tree.heightScaleMin + parkDraw(seed, PARK_HASH.height, index) * tree.heightScaleRange;
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

/**
 * Community garden: a compact formal allotment, deliberately unlike the open
 * lawn and grove of a park. Raised beds mirror across a gravel spine, clipped
 * hedges leave a legible south entrance, and a cream pergola marks the gate.
 */
export function addGarden(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): StructurePart[] {
  const f = makeServiceModelFrame(builder, surface, x, y, w, h);
  const { top } = f;
  const L = GARDEN_LAYOUT;
  const C = GARDEN_COLORS;
  f.pad(C.ground);
  f.box('path', L.path.x0, L.path.z0, L.path.x1, L.path.z1, top, top + L.path.top, C.path);

  const hedgeInner = L.hedge.inset + L.hedge.thick;
  f.box('hedge', L.hedge.inset, L.hedge.inset, 1 - L.hedge.inset, hedgeInner,
    top, top + L.hedge.top, C.hedge);
  f.box('hedge', L.hedge.inset, 1 - hedgeInner, L.hedge.entranceLeft, 1 - L.hedge.inset,
    top, top + L.hedge.top, C.hedge);
  f.box('hedge', L.hedge.entranceRight, 1 - hedgeInner, 1 - L.hedge.inset, 1 - L.hedge.inset,
    top, top + L.hedge.top, C.hedge);
  f.box('hedge', L.hedge.inset, hedgeInner, hedgeInner, 1 - hedgeInner,
    top, top + L.hedge.top, C.hedge);
  f.box('hedge', 1 - hedgeInner, hedgeInner, 1 - L.hedge.inset, 1 - hedgeInner,
    top, top + L.hedge.top, C.hedge);

  L.bedRows.forEach((row, rowIndex) => {
    L.bedColumns.forEach((column) => {
      f.part('raised-bed', () => {
        builder.coloredBox(f.u(column.x0), top, f.v(row.z0), f.u(column.x1),
          top + L.bed.borderTop, f.v(row.z1), colorOf(C.bedBorder));
        builder.coloredBox(f.u(column.x0 + L.bed.soilInset), top + L.bed.borderTop,
          f.v(row.z0 + L.bed.soilInset), f.u(column.x1 - L.bed.soilInset),
          top + L.bed.soilTop, f.v(row.z1 - L.bed.soilInset), colorOf(C.soil));
        builder.coloredBox(f.u(column.x0 + L.bed.cropInset), top + L.bed.soilTop,
          f.v(row.z0 + L.bed.soilInset), f.u(column.x1 - L.bed.cropInset),
          top + L.bed.cropTop, f.v(row.z1 - L.bed.soilInset),
          colorOf(C.crops[rowIndex % C.crops.length]));
      });
    });
  });

  const P = L.pergola;
  f.part('pergola', () => {
    const solid = (
      fx0: number, fz0: number, fx1: number, fz1: number,
      y0: number, y1: number,
    ): void => builder.coloredBox(f.u(fx0), y0, f.v(fz0), f.u(fx1), y1, f.v(fz1),
      colorOf(C.pergola));
    for (const fx of [P.left, P.right]) {
      for (const fz of [P.north, P.south]) {
        solid(fx - P.postHalf, fz - P.postHalf, fx + P.postHalf, fz + P.postHalf,
          top, top + P.postTop);
      }
      solid(fx - P.beamHalf, P.north - P.beamHalf, fx + P.beamHalf, P.south + P.beamHalf,
        top + P.beamBottom, top + P.beamTop);
    }
    for (const fz of [P.north, P.south]) {
      solid(P.left - P.beamHalf, fz - P.slatHalf, P.right + P.beamHalf, fz + P.slatHalf,
        top + P.slatBottom, top + P.slatTop);
    }
  });
  return f.parts;
}
