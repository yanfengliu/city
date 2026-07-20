import { colorOf, type GeometryBuilder } from './geometry-builder';
import {
  SERVICE_PAD_BURY,
  SERVICE_PAD_COLOR,
  SERVICE_PAD_LIFT,
  SERVICE_PAD_MARGIN,
  SERVICE_POST_SEGMENTS,
} from './structure-style';
import type { StructurePart } from './utility-structures';
import type { TerrainSurfaceView } from './terrain-surface';

/**
 * Shared scaffolding for one service model: part-bounds tracking plus
 * footprint-fraction helpers. Layout offsets are fractions of the service
 * footprint so every part stays inside it by construction; heights and
 * slender radii are absolute world units.
 */
export interface ServiceModelFrame {
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
  /** Levelled base slab; leisure landscapes override concrete with ground cover. */
  pad(color?: number): void;
}

export function makeServiceModelFrame(
  builder: GeometryBuilder,
  surface: TerrainSurfaceView,
  x: number,
  y: number,
  w: number,
  h: number,
): ServiceModelFrame {
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
  const box: ServiceModelFrame['box'] = (kind, fx0, fz0, fx1, fz1, y0, y1, color) => {
    part(kind, () => builder.coloredBox(u(fx0), y0, v(fz0), u(fx1), y1, v(fz1), colorOf(color)));
  };
  const roof: ServiceModelFrame['roof'] =
    (kind, fx, fz, y0, y1, eaveX, eaveZ, topX, topZ, color) => {
      part(kind, () =>
        builder.coloredBeam(
          [u(fx), y0, v(fz)],
          [u(fx), y1, v(fz)],
          [0, 0, 1],
          eaveX,
          eaveZ,
          topX,
          topZ,
          color,
        ),
      );
    };
  const post: ServiceModelFrame['post'] = (kind, fx, fz, y0, y1, r, color) => {
    part(kind, () =>
      builder.coloredTube(
        [u(fx), y0, v(fz)],
        [u(fx), y1, v(fz)],
        r,
        r,
        SERVICE_POST_SEGMENTS,
        color,
      ),
    );
  };
  const pad: ServiceModelFrame['pad'] = (color = SERVICE_PAD_COLOR) => {
    box(
      'pad',
      SERVICE_PAD_MARGIN,
      SERVICE_PAD_MARGIN,
      1 - SERVICE_PAD_MARGIN,
      1 - SERVICE_PAD_MARGIN,
      range.min - SERVICE_PAD_BURY,
      top,
      color,
    );
  };
  return { parts, top, u, v, part, box, roof, post, pad };
}
