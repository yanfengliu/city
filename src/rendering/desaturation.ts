import type {
  Color,
  Material,
  Object3D,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';

/**
 * Overlay-mode desaturation: while a map overlay is active the world renders
 * in shades of grey so the overlay is the only colored thing on screen.
 *
 * Every scene material gets a small fragment-shader epilogue mixing the final
 * pixel toward its luminance, gated by one shared uniform — so the toggle is a
 * single value write, no material swaps and no per-toggle recompiles. Meshes
 * that must stay colored (the overlays themselves, ghosts, indicators, FX) opt
 * out via a userData flag on their subtree root.
 */

/** Subtree flag: content under a flagged root keeps its color in overlay mode. */
const KEEP_COLOR_FLAG = 'overlayKeepColor';

/** Rec. 709 luminance weights — the grey a color collapses to. */
const LUMINANCE_R = 0.2126;
const LUMINANCE_G = 0.7152;
const LUMINANCE_B = 0.0722;

const UNIFORM_NAME = 'uOverlayDesaturate';
const UNIFORM_DECLARATION = `uniform float ${UNIFORM_NAME};\n`;
/** Runs after tone mapping, colorspace, and fog so the whole lit result greys. */
const DESATURATE_CHUNK = `gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(${LUMINANCE_R}, ${LUMINANCE_G}, ${LUMINANCE_B}))), ${UNIFORM_NAME});`;

/** Built-in materials end their fragment main with the dithering hook. */
const DITHERING_HOOK = '#include <dithering_fragment>';
/** Custom shaders (the sky dome) stop at colorspace; inject just after it. */
const COLORSPACE_HOOK = '#include <colorspace_fragment>';

/** Marks subtrees whose materials must keep their color in overlay mode. */
export function markOverlayKeepColor(...objects: Object3D[]): void {
  for (const object of objects) object.userData[KEEP_COLOR_FLAG] = true;
}

/** Collapses a color to its luminance in place (for the CPU-side clear color). */
export function desaturateToLuminance(color: Color): void {
  const luminance = LUMINANCE_R * color.r + LUMINANCE_G * color.g + LUMINANCE_B * color.b;
  color.r = luminance;
  color.g = luminance;
  color.b = luminance;
}

export class OverlayDesaturation {
  /** Shared by every patched program: 0 = full color, 1 = greyscale. */
  private readonly uniform = { value: 0 };
  private readonly patched = new WeakSet<Material>();

  get enabled(): boolean {
    return this.uniform.value === 1;
  }

  setEnabled(on: boolean): void {
    this.uniform.value = on ? 1 : 0;
  }

  /**
   * Walks a subtree and patches every material not under a keep-color root.
   * Idempotent and cheap on repeat visits, so it can run per added object and
   * as a per-frame sweep while an overlay is active (the embedded voxel lane
   * creates materials mid-play without going through CityScene.add()).
   */
  patchObject(root: Object3D): void {
    if (root.userData[KEEP_COLOR_FLAG] === true) return;
    const material = (root as { material?: Material | Material[] }).material;
    if (material !== undefined) {
      for (const entry of Array.isArray(material) ? material : [material]) {
        this.patchMaterial(entry);
      }
    }
    for (const child of root.children) this.patchObject(child);
  }

  private patchMaterial(material: Material): void {
    if (this.patched.has(material)) return;
    this.patched.add(material);
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (
      shader: WebGLProgramParametersWithUniforms,
      renderer: WebGLRenderer,
    ): void => {
      previousCompile.call(material, shader, renderer);
      this.inject(shader);
    };
    // Fold the original onBeforeCompile source into the key: the default key
    // stringifies the (now shared) wrapper, so two same-class materials with
    // different original hooks would otherwise collapse onto one program.
    material.customProgramCacheKey = () =>
      `${previousKey()}|overlay-desaturate|${previousCompile.toString()}`;
    // Already-compiled materials must recompile to pick up the epilogue.
    material.needsUpdate = true;
  }

  private inject(shader: WebGLProgramParametersWithUniforms): void {
    const source = shader.fragmentShader;
    if (source.includes(DITHERING_HOOK)) {
      shader.fragmentShader = source.replace(
        DITHERING_HOOK,
        `${DESATURATE_CHUNK}\n${DITHERING_HOOK}`,
      );
    } else if (source.includes(COLORSPACE_HOOK)) {
      shader.fragmentShader = source.replace(
        COLORSPACE_HOOK,
        `${COLORSPACE_HOOK}\n${DESATURATE_CHUNK}`,
      );
    } else {
      // No known hook (an exotic embedded shader): leave it colored rather
      // than risk breaking its program.
      return;
    }
    shader.fragmentShader = UNIFORM_DECLARATION + shader.fragmentShader;
    shader.uniforms[UNIFORM_NAME] = this.uniform;
  }
}
