import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { nearestInstanceHit } from '../../src/rendering/picking';

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

describe('nearestInstanceHit', () => {
  it('reports which instance of a batch the ray struck', () => {
    const people = batch([0, 4, 8]);
    const hit = nearestInstanceHit(rayAt(4), [people]);
    expect(hit).not.toBeNull();
    expect(hit!.mesh).toBe(people);
    expect(hit!.instanceId).toBe(1);
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
