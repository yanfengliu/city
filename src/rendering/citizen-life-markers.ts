import {
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  RingGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { CitizenDetail, CitizenPlace } from '../protocol/messages';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

const MARKER_Y = 0.06;
const PLACE_COLORS = {
  home: 0x67d9ff,
  work: 0xffa95c,
  destination: 0xef78ff,
} as const;

type PlaceKind = keyof typeof PLACE_COLORS;

interface OutlineGeometryKey {
  surface: TerrainSurfaceView;
  x: number;
  y: number;
  w: number;
  h: number;
}

type FootprintAnchor = { x: number; y: number; w: number; h: number };

const sameOutlineGeometry = (
  key: OutlineGeometryKey | null,
  surface: TerrainSurfaceView,
  place: Pick<CitizenPlace, 'x' | 'y' | 'w' | 'h'>,
): boolean =>
  key !== null &&
  key.surface === surface &&
  key.x === place.x &&
  key.y === place.y &&
  key.w === place.w &&
  key.h === place.h;

/**
 * Persistent map evidence for an inspected person's life anchors. A bright
 * footprint outline says where home/work are; a destination ring remains
 * distinct when it overlaps either one. These are presentation-only and are
 * updated from an on-demand citizen detail response, never from the ECS.
 */
export class CitizenLifeMarkers {
  readonly group = new Group();
  private readonly home = placeOutline('citizen-home-marker', PLACE_COLORS.home);
  private readonly work = placeOutline('citizen-work-marker', PLACE_COLORS.work);
  private readonly destination = destinationRing();
  private surface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
  private homeGeometryKey: OutlineGeometryKey | null = null;
  private workGeometryKey: OutlineGeometryKey | null = null;

  constructor() {
    this.group.name = 'citizen-life-markers';
    this.group.add(this.home, this.work, this.destination);
    this.hide();
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.surface = surface;
  }

  show(detail: CitizenDetail): void {
    this.placeOutline(this.home, detail.home, 'home');
    this.placeOutline(this.work, detail.work, 'work');
    // During a return leg activityPlace remains the venue being left, while
    // destination is the actual target. Retain activityPlace only as the
    // fallback for an at-venue phase with no live travel destination.
    this.placeDestination(
      detail.destinationPlace ?? detail.destination ?? detail.activityPlace,
    );
    this.group.visible =
      this.home.visible || this.work.visible || this.destination.visible;
  }

  hide(): void {
    this.group.visible = false;
    this.home.visible = false;
    this.work.visible = false;
    this.destination.visible = false;
  }

  private placeOutline(
    marker: LineLoop,
    place: CitizenPlace | null,
    kind: Exclude<PlaceKind, 'destination'>,
  ): void {
    marker.visible = place !== null;
    if (!place) return;
    const previousKey = kind === 'home' ? this.homeGeometryKey : this.workGeometryKey;
    if (sameOutlineGeometry(previousKey, this.surface, place)) return;
    const oldGeometry = marker.geometry;
    marker.geometry = footprintGeometry(this.surface, place);
    oldGeometry.dispose();
    const nextKey = {
      surface: this.surface,
      x: place.x,
      y: place.y,
      w: place.w,
      h: place.h,
    };
    if (kind === 'home') this.homeGeometryKey = nextKey;
    else this.workGeometryKey = nextKey;
    marker.userData.kind = kind;
  }

  private placeDestination(
    place: FootprintAnchor | null,
  ): void {
    this.destination.visible = place !== null;
    if (!place) return;
    const x = place.x + place.w / 2;
    const z = place.y + place.h / 2;
    this.destination.position.set(x, this.surface.heightAt(x, z) + MARKER_Y, z);
    const scale = Math.max(place.w, place.h) * 0.65 + 0.3;
    this.destination.scale.setScalar(scale);
  }
}

function placeOutline(name: string, color: number): LineLoop {
  const line = new LineLoop(
    footprintGeometry(FLAT_TERRAIN_SURFACE, null),
    new LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  line.name = name;
  line.renderOrder = 24;
  line.frustumCulled = false;
  return line;
}

function destinationRing(): Mesh<RingGeometry, MeshBasicMaterial> {
  const marker = new Mesh(
    new RingGeometry(0.42, 0.52, 28).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      color: PLACE_COLORS.destination,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  marker.name = 'citizen-destination-marker';
  marker.renderOrder = 25;
  marker.frustumCulled = false;
  return marker;
}

function footprintGeometry(
  surface: TerrainSurfaceView,
  place: CitizenPlace | null,
): BufferGeometry {
  if (!place) return new BufferGeometry();
  const points: number[] = [];
  const add = (x: number, z: number): void => {
    points.push(x, surface.heightAt(x, z) + MARKER_Y, z);
  };
  for (let x = place.x; x <= place.x + place.w; x++) add(x, place.y);
  for (let z = place.y + 1; z <= place.y + place.h; z++) add(place.x + place.w, z);
  for (let x = place.x + place.w - 1; x >= place.x; x--) add(x, place.y + place.h);
  for (let z = place.y + place.h - 1; z > place.y; z--) add(place.x, z);

  const geometry = new BufferGeometry();
  geometry.setFromPoints(Array.from(
    { length: points.length / 3 },
    (_, index) => new Vector3(
      points[index * 3],
      points[index * 3 + 1],
      points[index * 3 + 2],
    ),
  ));
  return geometry;
}
