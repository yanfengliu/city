import { BoxGeometry, PlaneGeometry } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BUILDING_FRONTAGE_PARTS,
  BUILDING_FRONTAGE_SURFACE_OFFSET,
  BUILDING_WINDOW_LAYOUTS,
  BUILDING_WINDOW_SURFACE_OFFSET,
  type ZoneKind,
} from './constants';

const mergeParts = (parts: BufferGeometry[], label: string): BufferGeometry => {
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`Could not merge ${label} geometry`);
  return merged;
};

const windowPanel = (
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
): BufferGeometry => new PlaneGeometry(width, height).rotateY(yaw).translate(x, y, z);

/** Literal low-poly windows on all four walls, authored in normalized body space. */
export function createBuildingWindowGeometry(zone: ZoneKind): BufferGeometry {
  const layout = BUILDING_WINDOW_LAYOUTS[zone];
  const surface = 0.5 + BUILDING_WINDOW_SURFACE_OFFSET;
  const parts: BufferGeometry[] = [];

  for (const y of layout.rows) {
    for (const x of layout.frontColumns) {
      parts.push(windowPanel(layout.width, layout.height, x, y, surface, 0));
      parts.push(windowPanel(layout.width, layout.height, x, y, -surface, Math.PI));
    }
    for (const z of layout.sideColumns) {
      parts.push(windowPanel(layout.width, layout.height, surface, y, z, Math.PI / 2));
      parts.push(windowPanel(layout.width, layout.height, -surface, y, z, -Math.PI / 2));
    }
  }

  return mergeParts(parts, `${zone} window`);
}

/** Zone-specific front-door/storefront/loading-bay assemblies in normalized body space. */
export function createBuildingFrontageGeometry(zone: ZoneKind): BufferGeometry {
  const parts = BUILDING_FRONTAGE_PARTS[zone].map((part) => {
    const [width, height, depth] = part.size;
    return new BoxGeometry(width, height, depth).translate(
      part.x,
      part.baseY + height / 2,
      0.5 + BUILDING_FRONTAGE_SURFACE_OFFSET + depth / 2,
    );
  });
  return mergeParts(parts, `${zone} frontage`);
}
