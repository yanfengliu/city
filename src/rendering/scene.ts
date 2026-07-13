import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MOUSE,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { ATMOSPHERE_COLORS, ATMOSPHERE_LIGHT_INTENSITY } from './constants';
import { refreshShadowsAfterContextRestore, ShadowMapUpdatePolicy } from './shadow-update';
import { FLAT_TERRAIN_SURFACE, type TerrainSurfaceView } from './terrain-surface';

/** WASD pan speed as a fraction of the camera-to-target distance, per second
 * (so panning is faster when zoomed out and slower when zoomed in). */
const KEY_PAN_FACTOR = 0.9;

// Sun-shadow map: one extra render pass covering the whole grid. 2048 with soft
// PCF keeps building shadows crisp enough at play zoom without a costly 4096 map.
const SHADOW_MAP_SIZE = 2048;
/** Ortho half-extent (world units) — covers the 128-cell grid plus a margin for
 * tall-building shadow throw. */
const SHADOW_HALF_EXTENT = 100;

/** Day and night endpoints for every lit/atmospheric colour, lerped by daylight. */
const PALETTE = {
  skyTopDay: new Color(ATMOSPHERE_COLORS.skyTopDay),
  skyTopNight: new Color(ATMOSPHERE_COLORS.skyTopNight),
  skyHorizonDay: new Color(ATMOSPHERE_COLORS.skyHorizonDay),
  skyHorizonNight: new Color(ATMOSPHERE_COLORS.skyHorizonNight),
  hemiSkyDay: new Color(ATMOSPHERE_COLORS.hemiSkyDay),
  hemiSkyNight: new Color(ATMOSPHERE_COLORS.hemiSkyNight),
  hemiGroundDay: new Color(ATMOSPHERE_COLORS.hemiGroundDay),
  hemiGroundNight: new Color(ATMOSPHERE_COLORS.hemiGroundNight),
  sunDay: new Color(ATMOSPHERE_COLORS.sunDay),
  sunLow: new Color(ATMOSPHERE_COLORS.sunLow), // warm, near the horizon (sunrise/sunset)
};

/**
 * Owns the Three.js renderer, scene graph, camera, and MapControls. Grid
 * dimensions arrive as plain numbers from app code — rendering never imports
 * sim modules. Content meshes (terrain, roads, trees, ghost) are added via
 * add() by the composition root.
 */
export class CityScene {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: MapControls;
  private readonly hemi: HemisphereLight;
  private readonly sun: DirectionalLight;
  /** Gradient sky dome; its shader colours are re-lerped each day/night frame. */
  private readonly sky: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly scratch = new Color();
  private flight: {
    start: number;
    fromTarget: Vector3;
    fromCamera: Vector3;
    toTarget: { x: number; z: number };
  } | null = null;
  private fps = 0;
  private frameCount = 0;
  private lastFpsSample = performance.now();
  private lastFrameTime = performance.now();
  private readonly frameCallbacks: Array<() => void> = [];
  /** Currently-held WASD keys, drained each frame into a camera pan. */
  private readonly panKeys = new Set<string>();
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private terrainSurface: TerrainSurfaceView = FLAT_TERRAIN_SURFACE;
  private readonly shadowUpdates = new ShadowMapUpdatePolicy();

  constructor(container: HTMLElement, gridWidth: number, gridHeight: number) {
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Filmic tone mapping + soft sun shadows lift the flat-shaded look without
    // touching the (cheap, instanced) Lambert materials.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // The sun and all casters are static between sim/caster changes. Reusing
    // the map avoids a 2048² shadow pass on every presentation frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    refreshShadowsAfterContextRestore(
      this.renderer.domElement,
      this.shadowUpdates,
      this.renderer.shadowMap,
    );
    container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = PALETTE.skyHorizonDay.clone();
    // Distance haze fades the map edges into the sky for depth.
    this.scene.fog = new Fog(PALETTE.skyHorizonDay.clone(), 70, 320);

    this.camera = new PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    // Boot looking at the highway gateway (top-centre) — that is where the
    // player draws their first road, so it should be front-and-centre, not a
    // speck across the map.
    this.camera.position.set(gridWidth / 2 - 6, 34, 62);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(gridWidth / 2, 0, 18);
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 220;
    // Hold the middle (wheel) button and drag to orbit; the scroll wheel still
    // zooms, so we repurpose the otherwise-redundant middle-drag dolly.
    this.controls.mouseButtons.MIDDLE = MOUSE.ROTATE;
    this.controls.update();

    // Hemisphere fill (sky above, warm ground bounce below) replaces flat
    // ambient so verticals read; the sun is the key light and the shadow caster.
    this.hemi = new HemisphereLight(PALETTE.hemiSkyDay, PALETTE.hemiGroundDay, 1.0);
    this.sun = new DirectionalLight(PALETTE.sunDay, 2.6);
    this.sun.position.set(80, 120, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -SHADOW_HALF_EXTENT;
    this.sun.shadow.camera.right = SHADOW_HALF_EXTENT;
    this.sun.shadow.camera.top = SHADOW_HALF_EXTENT;
    this.sun.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.sun.target.position.set(gridWidth / 2, 0, gridHeight / 2);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sky = this.makeSky(gridWidth, gridHeight);
    this.scene.add(this.sky);

    window.addEventListener('resize', () => {
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });

    // WASD pans the camera. Held keys accumulate here and are applied per frame;
    // ignored while a modifier is down or a text field is focused (mirrors the
    // tool-shortcut guard), and cleared on blur so a key can't get stuck held.
    const typing = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    window.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        this.panKeys.add(key);
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => this.panKeys.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => this.panKeys.clear());

    this.renderer.setAnimationLoop(() => this.renderFrame());
  }

  add(...objects: Object3D[]): void {
    this.scene.add(...objects);
  }

  /** Registers a callback run once per rendered frame, before drawing (dirty-flag flushes). */
  onFrame(callback: () => void): void {
    this.frameCallbacks.push(callback);
  }

  /**
   * While a build tool is active, left-drag draws instead of panning; middle
   * and right (both rotate) always stay with MapControls.
   */
  setLeftDragEnabled(enabled: boolean): void {
    this.controls.mouseButtons.LEFT = enabled ? MOUSE.PAN : null;
  }

  getCameraTarget(): Vector3 {
    return this.controls.target;
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.terrainSurface = surface;
    this.conformCameraTargetToTerrain();
    this.controls.update();
  }

  /** Call after tree/building/structure/bridge caster geometry changes. */
  invalidateShadows(): void {
    this.shadowUpdates.invalidate();
  }

  getTerrainSurface(): TerrainSurfaceView {
    return this.terrainSurface;
  }

  /**
   * Projects a point on the visible terrain (world x, z) to CSS client pixels — the
   * inverse of GroundPicker. Lets an automated player aim real pointer events
   * at a sim cell. `onScreen` is false when the point is behind the camera or
   * outside the viewport.
   */
  worldToScreen(x: number, z: number): { sx: number; sy: number; onScreen: boolean } {
    this.camera.updateMatrixWorld(); // background tabs throttle rAF → stale matrices
    const ndc = new Vector3(x, this.terrainSurface.groundHeightAt(x, z), z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      sx: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
      sy: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
      onScreen: ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
    };
  }

  /** Renders and returns the canvas as a JPEG data URL — a live "what the player
   * sees" capture. Pumps a full presentation frame first (view sync, vehicle
   * interpolation, level-up FX, camera flight) so the capture reflects the
   * current animated state even when the rAF loop is throttled — as it is in a
   * headless playtest tab, where a bare render would freeze time-based visuals
   * (stale vehicle positions, level-up labels that never fade). preserveDrawingBuffer
   * keeps the buffer readable after the render. */
  screenshot(quality = 0.7): string {
    this.presentFrame(performance.now());
    return this.renderer.domElement.toDataURL('image/jpeg', quality);
  }

  /**
   * Smoothly flies the camera to look at world cell (x, z) — used by the
   * advisor's click-to-locate. Eased tween of both controls target and
   * camera position over ~700ms; any user camera input after arrival wins.
   */
  flyTo(x: number, z: number): void {
    this.flight = {
      start: performance.now(),
      fromTarget: this.controls.target.clone(),
      fromCamera: this.camera.position.clone(),
      toTarget: { x, z },
    };
  }

  private updateFlight(now: number): void {
    if (!this.flight) return;
    const DURATION_MS = 700;
    const raw = Math.min(1, (now - this.flight.start) / DURATION_MS);
    const t = raw < 0.5 ? 2 * raw * raw : 1 - (-2 * raw + 2) ** 2 / 2; // easeInOutQuad
    const { fromTarget, fromCamera, toTarget } = this.flight;
    const targetX = fromTarget.x + (toTarget.x - fromTarget.x) * t;
    const targetZ = fromTarget.z + (toTarget.z - fromTarget.z) * t;
    // Keep a pleasant inspection distance/angle at the destination.
    const destCamX = toTarget.x;
    const destinationY = this.terrainSurface.heightAt(toTarget.x, toTarget.z);
    const targetY = this.terrainSurface.heightAt(targetX, targetZ);
    const destCamY = destinationY + 18;
    const destCamZ = toTarget.z + 16;
    this.controls.target.set(targetX, targetY, targetZ);
    this.camera.position.set(
      fromCamera.x + (destCamX - fromCamera.x) * t,
      fromCamera.y + (destCamY - fromCamera.y) * t,
      fromCamera.z + (destCamZ - fromCamera.z) * t,
    );
    if (raw >= 1) this.flight = null;
  }

  /**
   * WASD nudges the camera across the terrain surface, screen-relative (W = into
   * the view, A/D = left/right of it), scaled by zoom distance and frame time.
   * Interrupts any in-progress fly-to and keeps the focus over the map.
   */
  private applyKeyboardPan(dt: number): void {
    const x = (this.panKeys.has('d') ? 1 : 0) - (this.panKeys.has('a') ? 1 : 0);
    const z = (this.panKeys.has('w') ? 1 : 0) - (this.panKeys.has('s') ? 1 : 0);
    if (x === 0 && z === 0) return;
    this.flight = null; // live camera input wins over a tween
    const forward = new Vector3().subVectors(this.controls.target, this.camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    forward.normalize();
    const right = new Vector3(-forward.z, 0, forward.x);
    const speed = KEY_PAN_FACTOR * this.controls.getDistance() * dt;
    const move = new Vector3()
      .addScaledVector(forward, z * speed)
      .addScaledVector(right, x * speed);
    this.controls.target.add(move);
    this.camera.position.add(move);
    // Clamp the focus to the map, moving the camera by the same correction so
    // the view angle/distance is preserved.
    const cx = Math.max(0, Math.min(this.gridWidth, this.controls.target.x));
    const cz = Math.max(0, Math.min(this.gridHeight, this.controls.target.z));
    this.camera.position.x += cx - this.controls.target.x;
    this.camera.position.z += cz - this.controls.target.z;
    this.controls.target.x = cx;
    this.controls.target.z = cz;
    const targetY = this.terrainSurface.heightAt(cx, cz);
    this.camera.position.y += targetY - this.controls.target.y;
    this.controls.target.y = targetY;
  }

  /** One presentation pass: run frame callbacks (view sync, vehicle/FX
   * interpolation), advance any camera flight, sync controls, render. Shared by
   * the rAF loop and the on-demand `screenshot()` so both produce a live frame. */
  private presentFrame(now: number): void {
    for (const callback of this.frameCallbacks) callback();
    this.updateFlight(now);
    this.controls.update();
    this.conformCameraTargetToTerrain();
    this.renderer.render(this.scene, this.camera);
  }

  /** Keep mouse-drag panning at the terrain datum without changing its view angle. */
  private conformCameraTargetToTerrain(): void {
    const targetY = this.terrainSurface.heightAt(
      this.controls.target.x,
      this.controls.target.z,
    );
    const deltaY = targetY - this.controls.target.y;
    if (Math.abs(deltaY) < 1e-8) return;
    this.controls.target.y = targetY;
    this.camera.position.y += deltaY;
  }

  private renderFrame(): void {
    const now = performance.now();
    // Clamp dt so a backgrounded tab (rAF paused) doesn't resume with a huge pan.
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.applyKeyboardPan(dt);
    this.presentFrame(now);
    this.frameCount++;
    if (now - this.lastFpsSample >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsSample));
      this.frameCount = 0;
      this.lastFpsSample = now;
    }
  }

  /** A large back-faced dome with a horizon→zenith gradient shader (unfogged). */
  private makeSky(gridWidth: number, gridHeight: number): Mesh<SphereGeometry, ShaderMaterial> {
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: PALETTE.skyTopDay.clone() },
        horizonColor: { value: PALETTE.skyHorizonDay.clone() },
        center: { value: new Vector3(gridWidth / 2, 0, gridHeight / 2) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 center;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld - center).y;
          gl_FragColor = vec4(mix(horizonColor, topColor, pow(max(h, 0.0), 0.5)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new Mesh(new SphereGeometry(500, 32, 16), material);
    mesh.position.set(gridWidth / 2, 0, gridHeight / 2);
    mesh.frustumCulled = false;
    mesh.name = 'sky';
    return mesh;
  }

  /**
   * Day/night: the sun orbits with the sim's day fraction (0 = midnight) and
   * drives every lit/atmospheric colour. Night dims (and cools) rather than
   * blacks out so the city stays readable; low sun goes warm for sunrise/sunset.
   * Returns the daylight factor (0 at night → 1 at noon) so callers can drive
   * night-only effects (e.g. building window glow).
   */
  setDayFraction(fraction: number): number {
    const angle = (fraction - 0.25) * Math.PI * 2; // sunrise at 0.25
    const height = Math.sin(angle);
    this.sun.position.set(
      this.gridWidth / 2 + Math.cos(angle) * 120,
      Math.max(12, height * 120),
      this.gridHeight / 2 + Math.sin(angle * 0.5) * 40,
    );
    const daylight = Math.max(0, height);
    const castShadow = daylight > 0.15;
    if (this.sun.castShadow !== castShadow) this.shadowUpdates.invalidate();
    this.sun.castShadow = castShadow;
    if (this.shadowUpdates.consume(fraction, castShadow)) {
      this.renderer.shadowMap.needsUpdate = true;
    }

    // Sun: warm and dim near the horizon, bright and neutral when high.
    const warmth = 1 - Math.min(1, Math.max(0, height) / 0.4);
    this.sun.color.copy(PALETTE.sunDay).lerp(PALETTE.sunLow, warmth);
    this.sun.intensity =
      ATMOSPHERE_LIGHT_INTENSITY.sunBase +
      ATMOSPHERE_LIGHT_INTENSITY.sunDaylightBoost * daylight;

    // Hemisphere fill — a high night floor keeps the ground clearly readable
    // (paired with the buildings' warm window glow) so a night city stays playable:
    // night reads as a lit dusk, not a black-out.
    this.hemi.intensity =
      ATMOSPHERE_LIGHT_INTENSITY.hemisphereBase +
      ATMOSPHERE_LIGHT_INTENSITY.hemisphereNightBoost * (1 - daylight);
    this.hemi.color.copy(PALETTE.hemiSkyNight).lerp(PALETTE.hemiSkyDay, daylight);
    this.hemi.groundColor.copy(PALETTE.hemiGroundNight).lerp(PALETTE.hemiGroundDay, daylight);

    // Atmosphere: fog, clear colour, and sky dome share one horizon lerp.
    const horizon = this.scratch.copy(PALETTE.skyHorizonNight).lerp(PALETTE.skyHorizonDay, daylight);
    (this.scene.fog as Fog).color.copy(horizon);
    (this.scene.background as Color).copy(horizon);
    this.sky.material.uniforms.horizonColor.value.copy(horizon);
    this.sky.material.uniforms.topColor.value.copy(PALETTE.skyTopNight).lerp(PALETTE.skyTopDay, daylight);
    return daylight;
  }

  getFps(): number {
    return this.fps;
  }
}
