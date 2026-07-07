import {
  BoxGeometry,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
} from 'three';
import type { BufferGeometry } from 'three';
import {
  BUILDING_ABANDONED_ROOF_COLOR,
  BUILDING_ABANDONED_WALL_COLOR,
  BUILDING_DETAIL_COLOR,
  BUILDING_DETAIL_HEIGHT,
  BUILDING_DETAIL_WIDTH,
  BUILDING_FACADE_BASE_Y,
  BUILDING_FACADE_COLORS,
  BUILDING_FACADE_DEPTH,
  BUILDING_FACADE_FRONT_OFFSET,
  BUILDING_FACADE_GLOW_MAX,
  BUILDING_FACADE_HEIGHT,
  BUILDING_FACADE_WIDTH,
  BUILDING_FACADE_X_JITTER,
  BUILDING_FOOTPRINT_JITTER,
  BUILDING_FOOTPRINT_MARGIN,
  BUILDING_HEIGHT_JITTER,
  BUILDING_LEVEL_HEIGHTS,
  BUILDING_LEVEL_ROOF_LIGHTEN,
  BUILDING_LEVEL_WALL_LIGHTEN,
  BUILDING_NIGHT_GLOW_COLOR,
  BUILDING_NIGHT_GLOW_MAX,
  BUILDING_TINT_HUE_JITTER,
  BUILDING_TINT_LIGHT_JITTER,
  BUILDING_ROOF_COLORS,
  BUILDING_ROOF_HEIGHTS,
  BUILDING_ROOF_OVERHANG,
  BUILDING_START_CAPACITY,
  BUILDING_WALL_COLORS,
  cellHash01,
  type ZoneKind,
} from './constants';

/** Plain-data building view (structurally mirrors the protocol BuildingView). */
export interface BuildingRenderView {
  id: number;
  /** Footprint anchor (top-left cell) and size in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  zone: ZoneKind;
  level: number;
  abandoned: boolean;
}

interface Archetype {
  zone: ZoneKind;
  walls: InstancedMesh;
  roofs: InstancedMesh;
  details: InstancedMesh;
  facades: InstancedMesh;
  /** Building id per instance slot (parallel to the instance buffers). */
  ids: number[];
  capacity: number;
}

const MATRIX = new Matrix4();
const COLOR = new Color();

/**
 * Grown RCI buildings as instanced walls + roofs + roof details, one archetype
 * per zone (separate InstancedMeshes sharing a slot layout so the roof/detail
 * layers keep constant thickness and their own colors). Incremental
 * upserts/removals with an id -> slot map and swap-remove; capacity doubles
 * when full. Abandoned buildings grey out via instance color.
 */
export class BuildingsView {
  readonly group = new Group();
  private readonly archetypes: Record<ZoneKind, Archetype>;
  private readonly slots = new Map<number, { zone: ZoneKind; slot: number }>();
  private readonly unitBox: BufferGeometry;
  private readonly pyramidRoof: BufferGeometry;
  private readonly detailBox: BufferGeometry;
  private readonly facadeBox: BufferGeometry;
  private readonly material = new MeshLambertMaterial({
    color: 0xffffff,
    emissive: BUILDING_NIGHT_GLOW_COLOR,
    emissiveIntensity: 0,
  });
  private readonly facadeMaterial = new MeshLambertMaterial({
    color: 0xffffff,
    emissive: BUILDING_NIGHT_GLOW_COLOR,
    emissiveIntensity: 0,
  });

  constructor() {
    this.group.name = 'buildings';
    // Unit-space geometry with the base at y=0; per-instance matrices scale to
    // footprint * margin horizontally and level height (walls) vertically.
    this.unitBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    // 4-sided cone rotated 45° = square pyramid whose base matches the unit box.
    this.pyramidRoof = new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    this.detailBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.facadeBox = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.archetypes = {
      R: this.makeArchetype('R'),
      C: this.makeArchetype('C'),
      I: this.makeArchetype('I'),
    };
  }

  get count(): number {
    return this.slots.size;
  }

  /** Ramps the shared warm emissive with darkness (night ∈ [0,1]) so the city
   * lights up at night instead of vanishing. Cheap — one material uniform. */
  setNightGlow(night: number): void {
    const clamped = Math.max(0, Math.min(1, night));
    this.material.emissiveIntensity = clamped * BUILDING_NIGHT_GLOW_MAX;
    this.facadeMaterial.emissiveIntensity = clamped * BUILDING_FACADE_GLOW_MAX;
  }

  upsert(view: BuildingRenderView): void {
    const existing = this.slots.get(view.id);
    if (existing && existing.zone !== view.zone) this.remove(view.id); // defensive: zone never changes in-place
    const current = this.slots.get(view.id);
    const archetype = this.archetypes[view.zone];
    if (current) {
      this.writeInstance(archetype, current.slot, view);
      return;
    }
    if (archetype.ids.length === archetype.capacity) this.grow(archetype);
    const slot = archetype.ids.length;
    archetype.ids.push(view.id);
    this.slots.set(view.id, { zone: view.zone, slot });
    archetype.walls.count = archetype.ids.length;
    archetype.roofs.count = archetype.ids.length;
    archetype.details.count = archetype.ids.length;
    archetype.facades.count = archetype.ids.length;
    this.writeInstance(archetype, slot, view);
  }

  /** Tolerates unknown ids — the sim's removal stream covers all destroyed entities. */
  remove(id: number): void {
    const entry = this.slots.get(id);
    if (!entry) return;
    this.slots.delete(id);
    const archetype = this.archetypes[entry.zone];
    const last = archetype.ids.length - 1;
    if (entry.slot !== last) {
      const movedId = archetype.ids[last];
      for (const mesh of [archetype.walls, archetype.roofs, archetype.details, archetype.facades]) {
        mesh.getMatrixAt(last, MATRIX);
        mesh.setMatrixAt(entry.slot, MATRIX);
        mesh.getColorAt(last, COLOR);
        mesh.setColorAt(entry.slot, COLOR);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      archetype.ids[entry.slot] = movedId;
      this.slots.set(movedId, { zone: entry.zone, slot: entry.slot });
    }
    archetype.ids.pop();
    archetype.walls.count = archetype.ids.length;
    archetype.roofs.count = archetype.ids.length;
    archetype.details.count = archetype.ids.length;
    archetype.facades.count = archetype.ids.length;
  }

  private makeArchetype(zone: ZoneKind): Archetype {
    const roofGeometry = zone === 'R' ? this.pyramidRoof : this.unitBox;
    return {
      zone,
      walls: this.makeMesh(this.unitBox, BUILDING_START_CAPACITY, `${zone}-walls`),
      roofs: this.makeMesh(roofGeometry, BUILDING_START_CAPACITY, `${zone}-roofs`),
      details: this.makeMesh(this.detailBox, BUILDING_START_CAPACITY, `${zone}-roof-details`),
      facades: this.makeMesh(this.facadeBox, BUILDING_START_CAPACITY, `${zone}-facades`, {
        material: this.facadeMaterial,
        shadows: false,
      }),
      ids: [],
      capacity: BUILDING_START_CAPACITY,
    };
  }

  private makeMesh(
    geometry: BufferGeometry,
    capacity: number,
    name = '',
    options: { material?: MeshLambertMaterial; shadows?: boolean } = {},
  ): InstancedMesh {
    const material = options.material ?? this.material;
    const shadows = options.shadows ?? true;
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // Pre-allocate instance colors so write/copy paths never hit a null buffer.
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }

  private grow(archetype: Archetype): void {
    archetype.capacity *= 2;
    archetype.walls = this.replaceMesh(archetype.walls, archetype.capacity);
    archetype.roofs = this.replaceMesh(archetype.roofs, archetype.capacity);
    archetype.details = this.replaceMesh(archetype.details, archetype.capacity);
    archetype.facades = this.replaceMesh(archetype.facades, archetype.capacity, {
      material: this.facadeMaterial,
      shadows: false,
    });
  }

  private replaceMesh(
    old: InstancedMesh,
    capacity: number,
    options: { material?: MeshLambertMaterial; shadows?: boolean } = {},
  ): InstancedMesh {
    const next = this.makeMesh(old.geometry, capacity, old.name, options);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    if (next.instanceColor && old.instanceColor) {
      (next.instanceColor.array as Float32Array).set(old.instanceColor.array as Float32Array);
      next.instanceColor.needsUpdate = true;
    }
    next.count = old.count;
    next.instanceMatrix.needsUpdate = true;
    this.group.remove(old);
    old.dispose();
    return next;
  }

  private writeInstance(archetype: Archetype, slot: number, view: BuildingRenderView): void {
    const levelIndex = Math.min(Math.max(view.level, 1), BUILDING_LEVEL_HEIGHTS.length) - 1;
    const jitter = 1 + (cellHash01(view.id) - 0.5) * BUILDING_HEIGHT_JITTER;
    const height = BUILDING_LEVEL_HEIGHTS[levelIndex] * jitter;
    const cx = view.x + view.w / 2;
    const cz = view.y + view.h / 2;
    // Independent per-axis footprint shrink so neighbours don't read as clones.
    const sx = view.w * (BUILDING_FOOTPRINT_MARGIN - cellHash01(view.id + 0x1111) * BUILDING_FOOTPRINT_JITTER);
    const sz = view.h * (BUILDING_FOOTPRINT_MARGIN - cellHash01(view.id + 0x2222) * BUILDING_FOOTPRINT_JITTER);

    MATRIX.makeScale(sx, height, sz).setPosition(cx, 0, cz);
    archetype.walls.setMatrixAt(slot, MATRIX);
    const roofSx = Math.min(view.w * 0.98, sx + BUILDING_ROOF_OVERHANG);
    const roofSz = Math.min(view.h * 0.98, sz + BUILDING_ROOF_OVERHANG);
    const roofHeight = BUILDING_ROOF_HEIGHTS[view.zone];
    MATRIX.makeScale(roofSx, roofHeight, roofSz).setPosition(cx, height, cz);
    archetype.roofs.setMatrixAt(slot, MATRIX);
    const detailX = cx + (cellHash01(view.id + 0x6666) - 0.5) * sx * 0.35;
    const detailZ = cz + (cellHash01(view.id + 0x7777) - 0.5) * sz * 0.35;
    const detailWidth = Math.min(BUILDING_DETAIL_WIDTH, Math.min(sx, sz) * 0.35);
    MATRIX.makeScale(detailWidth, BUILDING_DETAIL_HEIGHT, detailWidth).setPosition(
      detailX,
      height + roofHeight * 0.82,
      detailZ,
    );
    archetype.details.setMatrixAt(slot, MATRIX);
    const facadeWidth = Math.min(BUILDING_FACADE_WIDTH, sx * 0.35);
    const facadeHeight = Math.min(BUILDING_FACADE_HEIGHT, height * 0.45);
    const facadeX = cx + (cellHash01(view.id + 0x8888) - 0.5) * sx * BUILDING_FACADE_X_JITTER;
    const facadeZ = cz + sz / 2 + BUILDING_FACADE_DEPTH / 2 + BUILDING_FACADE_FRONT_OFFSET;
    MATRIX.makeScale(facadeWidth, facadeHeight, BUILDING_FACADE_DEPTH).setPosition(
      facadeX,
      BUILDING_FACADE_BASE_Y,
      facadeZ,
    );
    archetype.facades.setMatrixAt(slot, MATRIX);

    if (view.abandoned) {
      // Per-building shade jitter so a derelict block reads as varied, weathered
      // stock rather than a wall of identical grey clones. Lightness only (grey
      // stays grey) and slightly stronger than the live jitter for visible decay.
      const decayJit = (cellHash01(view.id + 0x5555) - 0.5) * BUILDING_TINT_LIGHT_JITTER * 1.5;
      archetype.walls.setColorAt(slot, COLOR.setHex(BUILDING_ABANDONED_WALL_COLOR).offsetHSL(0, 0, decayJit));
      archetype.roofs.setColorAt(slot, COLOR.setHex(BUILDING_ABANDONED_ROOF_COLOR).offsetHSL(0, 0, decayJit));
      archetype.details.setColorAt(slot, COLOR.setHex(BUILDING_DETAIL_COLOR).offsetHSL(0, 0, decayJit * 0.5));
      archetype.facades.setColorAt(slot, COLOR.setHex(BUILDING_ABANDONED_ROOF_COLOR).offsetHSL(0, 0, decayJit));
    } else {
      // Subtle per-building tint (walls and roof shift together) on top of the
      // per-level lightening, so a district varies without losing its zone hue.
      const hueJit = (cellHash01(view.id + 0x3333) - 0.5) * BUILDING_TINT_HUE_JITTER;
      const lightJit = (cellHash01(view.id + 0x4444) - 0.5) * BUILDING_TINT_LIGHT_JITTER;
      COLOR.setHex(BUILDING_WALL_COLORS[view.zone]);
      COLOR.offsetHSL(hueJit, 0, BUILDING_LEVEL_WALL_LIGHTEN * levelIndex + lightJit);
      archetype.walls.setColorAt(slot, COLOR);
      COLOR.setHex(BUILDING_ROOF_COLORS[view.zone]);
      COLOR.offsetHSL(hueJit, 0, BUILDING_LEVEL_ROOF_LIGHTEN * levelIndex + lightJit);
      archetype.roofs.setColorAt(slot, COLOR);
      archetype.details.setColorAt(slot, COLOR.setHex(BUILDING_DETAIL_COLOR).offsetHSL(hueJit, 0, lightJit * 0.5));
      archetype.facades.setColorAt(
        slot,
        COLOR.setHex(BUILDING_FACADE_COLORS[view.zone]).offsetHSL(hueJit, 0, lightJit),
      );
    }
    for (const mesh of [archetype.walls, archetype.roofs, archetype.details, archetype.facades]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
