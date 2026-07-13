import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  Sprite,
  Vector3,
} from 'three';
import {
  UTILITY_ICON_SCALE,
} from '../../src/rendering/constants';
import {
  UtilityIconsFx,
  type IconBuildingView,
} from '../../src/rendering/utility-icons-fx';

function building(
  id: number,
  powered: boolean,
  watered: boolean,
): IconBuildingView {
  return {
    id,
    x: id % 40,
    y: Math.floor(id / 40),
    w: 1,
    h: 1,
    zone: 'R',
    level: 1,
    abandoned: false,
    powered,
    watered,
  };
}

describe('UtilityIconsFx instanced batches', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('collapses hundreds of warnings into at most one draw batch per icon key', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    const fx = new UtilityIconsFx();
    for (let id = 1; id <= 474; id++) {
      const mode = id % 3;
      fx.sync(building(id, mode === 0, mode === 1));
    }

    fx.updateFrame(1_000, new Quaternion());

    expect(fx.count).toBe(474);
    expect(fx.group.children).toHaveLength(3);
    expect(fx.group.children.every((child) => child instanceof InstancedMesh)).toBe(true);
    expect(fx.group.children.some((child) => child instanceof Sprite)).toBe(false);
    expect(
      fx.group.children.map((child) => (child as InstancedMesh).count).sort((a, b) => a - b),
    ).toEqual([158, 158, 158]);
    expect(
      fx.group.children.map((child) => child.renderOrder).sort((a, b) => a - b),
    ).toEqual([3, 4, 5]);
  });

  it('keeps batch membership correct through key changes and removals', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    const fx = new UtilityIconsFx();
    fx.sync(building(1, false, true));
    fx.sync(building(2, true, false));
    fx.sync(building(3, false, false));
    fx.updateFrame(0, new Quaternion());
    expect(fx.group.children.map((child) => (child as InstancedMesh).count)).toEqual([1, 1, 1]);

    fx.sync(building(1, false, false));
    fx.remove(3);
    fx.updateFrame(100, new Quaternion());

    expect(fx.count).toBe(2);
    expect(
      fx.group.children.map((child) => (child as InstancedMesh).count).sort((a, b) => a - b),
    ).toEqual([0, 1, 1]);
  });

  it('writes billboard transforms with the existing badge aspect and bobbing contract', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    const fx = new UtilityIconsFx();
    fx.sync(building(1, false, false));
    const cameraQuaternion = new Quaternion().setFromEuler(new Euler(-0.7, 0.4, 0));
    fx.updateFrame(0, cameraQuaternion);
    const mesh = fx.group.children[0] as InstancedMesh;
    const material = mesh.material as MeshBasicMaterial;
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    mesh.getMatrixAt(0, matrix);
    matrix.decompose(position, rotation, scale);

    expect(position.x).toBe(1.5);
    expect(position.z).toBe(0.5);
    expect(scale.x).toBeCloseTo(UTILITY_ICON_SCALE * 2);
    expect(scale.y).toBeCloseTo(UTILITY_ICON_SCALE);
    expect(rotation.angleTo(cameraQuaternion)).toBeCloseTo(0);
    expect(mesh.instanceMatrix.version).toBeGreaterThan(0);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.renderOrder).toBe(5);
    expect(material).toBeInstanceOf(MeshBasicMaterial);
    expect(material).toMatchObject({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    expect((material.map?.image as { width: number; height: number })).toMatchObject({
      width: 256,
      height: 128,
    });
    expect(material.map?.colorSpace).toBe(SRGBColorSpace);
  });
});
