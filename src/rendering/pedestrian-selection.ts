import {
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Sphere,
} from 'three';
import { PEDESTRIAN_CAPACITY } from './constants';
import type { EntityRef, PedestrianView } from '../protocol/messages';

export interface PedestrianCitizenRef extends EntityRef {
  /** Stable household-local person making this trip. */
  memberId: number;
}

export const samePedestrianCitizenRef = (
  a: PedestrianCitizenRef | null,
  b: PedestrianCitizenRef | null,
): boolean =>
  a?.id === b?.id && a?.generation === b?.generation && a?.memberId === b?.memberId;

export const pedestrianCitizenMatches = (
  walker: PedestrianCitizenRef | null,
  target: PedestrianCitizenRef | null,
): boolean => target !== null && samePedestrianCitizenRef(walker, target);

export function pedestrianCitizenRef(
  pedestrian: PedestrianView,
): PedestrianCitizenRef | null {
  const { citizen, citizenGeneration, memberId } = pedestrian;
  return citizen === undefined || citizenGeneration === undefined || memberId === undefined
    ? null
    : { id: citizen, generation: citizenGeneration, memberId };
}

/**
 * A walker's visual silhouette is intentionally tiny. Picking gets a wider,
 * person-height cylinder so a click can be close rather than pixel-perfect.
 * The batch is raycast directly and is never added to the scene, so it costs
 * no draw call and cannot tint the framebuffer.
 */
export const PEDESTRIAN_PICK_RADIUS = 0.24;
export const PEDESTRIAN_PICK_HEIGHT = 0.62;
export const PEDESTRIAN_MARKER_Y = 0.025;

const MARKER_SEGMENTS = 24;

export interface PedestrianSelectionMarkers {
  group: Group;
  hover: Mesh<RingGeometry, MeshBasicMaterial>;
  selected: Mesh<RingGeometry, MeshBasicMaterial>;
}

export function createPedestrianPickMesh(): InstancedMesh {
  const geometry = new CylinderGeometry(
    PEDESTRIAN_PICK_RADIUS,
    PEDESTRIAN_PICK_RADIUS,
    PEDESTRIAN_PICK_HEIGHT,
    8,
  ).translate(0, PEDESTRIAN_PICK_HEIGHT / 2, 0);
  const mesh = new InstancedMesh(geometry, new MeshBasicMaterial(), PEDESTRIAN_CAPACITY);
  mesh.name = 'pedestrian-pick-targets';
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Refreshes Three's cached InstancedMesh crowd sphere alongside the matrices.
 * This repairs a cache first computed at count=0 (radius -1) and conservatively
 * covers both the animated silhouette and the wider pick cylinders.
 */
export function setPedestrianCrowdBounds(
  meshes: readonly InstancedMesh[],
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): void {
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY + PEDESTRIAN_PICK_HEIGHT) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const halfX = (maxX - minX) / 2 + PEDESTRIAN_PICK_RADIUS;
  const halfY = (maxY - minY + PEDESTRIAN_PICK_HEIGHT) / 2;
  const halfZ = (maxZ - minZ) / 2 + PEDESTRIAN_PICK_RADIUS;
  const radius = Math.hypot(halfX, halfY, halfZ);
  for (const mesh of meshes) {
    const sphere = mesh.boundingSphere ?? new Sphere();
    sphere.center.set(centerX, centerY, centerZ);
    sphere.radius = radius;
    mesh.boundingSphere = sphere;
  }
}

function marker(
  name: string,
  innerRadius: number,
  outerRadius: number,
  color: number,
  opacity: number,
): Mesh<RingGeometry, MeshBasicMaterial> {
  const geometry = new RingGeometry(innerRadius, outerRadius, MARKER_SEGMENTS)
    .rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return mesh;
}

/** Persistent scene objects; callers only move/show them, never allocate per frame. */
export function createPedestrianSelectionMarkers(): PedestrianSelectionMarkers {
  const group = new Group();
  group.name = 'pedestrian-selection-markers';
  const hover = marker('pedestrian-hover-ring', 0.19, 0.235, 0x8fe0ff, 0.9);
  const selected = marker('pedestrian-selection-ring', 0.245, 0.315, 0xffcf57, 1);
  group.add(hover, selected);
  return { group, hover, selected };
}
