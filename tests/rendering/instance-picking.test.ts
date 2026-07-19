import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from 'three';
import {
  GroundPicker,
  instanceHitIsVisible,
  nearestInstanceHit,
} from '../../src/rendering/picking';
import { createPedestrianPickMesh } from '../../src/rendering/pedestrian-selection';

/** Batch of unit cubes, one per x position given. */
function batch(xs: readonly number[], z = 0): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 8);
  mesh.count = xs.length;
  const matrix = new Matrix4();
  xs.forEach((x, i) => {
    matrix.makeTranslation(x, 0, z);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Ray pointing straight down the -Z axis at (x, 0). */
function rayAt(x: number): Raycaster {
  return new Raycaster(new Vector3(x, 0, 20), new Vector3(0, 0, -1));
}

function blocker(z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(2, 2, 1), new MeshBasicMaterial());
  mesh.position.z = z;
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('nearestInstanceHit', () => {
  it('reports which instance of a batch the ray struck', () => {
    const people = batch([0, 4, 8]);
    const hit = nearestInstanceHit(rayAt(4), [people]);
    expect(hit).not.toBeNull();
    expect(hit!.mesh).toBe(people);
    expect(hit!.instanceId).toBe(1);
    expect(hit!.distance).toBeCloseTo(19.5, 5);
  });

  it('returns null when the ray misses every instance', () => {
    expect(nearestInstanceHit(rayAt(100), [batch([0, 4, 8])])).toBeNull();
  });

  it('prefers the nearest batch when several overlap', () => {
    const near = batch([0], 10);
    const far = batch([0], -10);
    const hit = nearestInstanceHit(rayAt(0), [far, near]);
    // `near` sits closer to the ray origin at z=20 and must win regardless of
    // the order the batches are offered in.
    expect(hit!.mesh).toBe(near);
  });

  it('skips empty batches so a stale capacity slot is never picked', () => {
    const empty = batch([]);
    const live = batch([0]);
    expect(nearestInstanceHit(rayAt(0), [empty, live])!.mesh).toBe(live);
  });

  it('skips hidden batches', () => {
    const hidden = batch([0], 10);
    hidden.visible = false;
    const live = batch([0], -10);
    expect(nearestInstanceHit(rayAt(0), [hidden, live])!.mesh).toBe(live);
  });
});

describe('instance hit visibility', () => {
  it('rejects a hit behind a nearer visible blocker but not one in front of it', () => {
    const raycaster = rayAt(0);
    const person = nearestInstanceHit(raycaster, [batch([0])])!;

    expect(instanceHitIsVisible(raycaster, person, [blocker(10)])).toBe(false);
    expect(instanceHitIsVisible(raycaster, person, [blocker(-10)])).toBe(true);
  });

  it('ignores blockers hidden by their own visibility, material, or parent', () => {
    const raycaster = rayAt(0);
    const person = nearestInstanceHit(raycaster, [batch([0])])!;
    const hidden = blocker(10);
    hidden.visible = false;
    expect(instanceHitIsVisible(raycaster, person, [hidden])).toBe(true);

    hidden.visible = true;
    (hidden.material as MeshBasicMaterial).visible = false;
    expect(instanceHitIsVisible(raycaster, person, [hidden])).toBe(true);

    (hidden.material as MeshBasicMaterial).visible = true;
    const hiddenParent = new Group();
    hiddenParent.visible = false;
    hiddenParent.add(hidden);
    expect(instanceHitIsVisible(raycaster, person, [hiddenParent])).toBe(true);
  });

  it('lets GroundPicker apply optional blockers to its instance hit', () => {
    const camera = new PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const element = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    } as HTMLElement;
    const picker = new GroundPicker(camera, element, 1, 1);
    const person = batch([0]);
    const building = blocker(10);

    expect(picker.pickInstance(50, 50, [person])).not.toBeNull();
    expect(picker.pickInstance(50, 50, [person], [building])).toBeNull();
  });

  it('prefers the projected person centre when forgiving crowd proxies overlap', () => {
    const width = 1280;
    const height = 720;
    const camera = new PerspectiveCamera(45, width / height, 0.1, 1_000);
    camera.position.set(58, 34, 62);
    camera.lookAt(64, 0, 64);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const element = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    } as HTMLElement;
    const picker = new GroundPicker(camera, element, 128, 128);
    const people = createPedestrianPickMesh();
    people.count = 2;
    people.setMatrixAt(0, new Matrix4().makeTranslation(64, 0, 64));
    people.setMatrixAt(1, new Matrix4().makeTranslation(64.25, 0, 64));
    people.instanceMatrix.needsUpdate = true;
    people.computeBoundingSphere();

    const intended = new Vector3(64.25, 0.31, 64).project(camera);
    const clientX = ((intended.x + 1) / 2) * width;
    const clientY = ((1 - intended.y) / 2) * height;

    expect(picker.pickInstance(clientX, clientY, [people])?.instanceId).toBe(1);
  });
});
