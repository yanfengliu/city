import {
  AmbientLight,
  Color,
  DirectionalLight,
  MOUSE,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

/** WASD pan speed as a fraction of the camera-to-target distance, per second
 * (so panning is faster when zoomed out and slower when zoomed in). */
const KEY_PAN_FACTOR = 0.9;

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
  private readonly ambient: AmbientLight;
  private readonly sun: DirectionalLight;
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

  constructor(container: HTMLElement, gridWidth: number, gridHeight: number) {
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = new Color(0x87b5d6);

    this.camera = new PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    this.camera.position.set(gridWidth / 2, 60, gridHeight / 2 + 60);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(gridWidth / 2, 0, gridHeight / 2);
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 220;
    // Hold the middle (wheel) button and drag to orbit; the scroll wheel still
    // zooms, so we repurpose the otherwise-redundant middle-drag dolly.
    this.controls.mouseButtons.MIDDLE = MOUSE.ROTATE;
    this.controls.update();

    this.ambient = new AmbientLight(0xffffff, 0.7);
    this.sun = new DirectionalLight(0xfff4e0, 1.6);
    this.sun.position.set(80, 120, 40);
    this.scene.add(this.ambient, this.sun);

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
    const destCamY = 18;
    const destCamZ = toTarget.z + 16;
    this.controls.target.set(targetX, 0, targetZ);
    this.camera.position.set(
      fromCamera.x + (destCamX - fromCamera.x) * t,
      fromCamera.y + (destCamY - fromCamera.y) * t,
      fromCamera.z + (destCamZ - fromCamera.z) * t,
    );
    if (raw >= 1) this.flight = null;
  }

  /**
   * WASD nudges the camera across the ground plane, screen-relative (W = into
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
  }

  private renderFrame(): void {
    const now = performance.now();
    // Clamp dt so a backgrounded tab (rAF paused) doesn't resume with a huge pan.
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    for (const callback of this.frameCallbacks) callback();
    this.applyKeyboardPan(dt);
    this.updateFlight(now);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
    if (now - this.lastFpsSample >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsSample));
      this.frameCount = 0;
      this.lastFpsSample = now;
    }
  }

  /**
   * Day/night: the sun orbits with the sim's day fraction (0 = midnight).
   * Night dims rather than blacks out so the city stays readable.
   */
  setDayFraction(fraction: number): void {
    const angle = (fraction - 0.25) * Math.PI * 2; // sunrise at 0.25
    const height = Math.sin(angle);
    this.sun.position.set(
      64 + Math.cos(angle) * 120,
      Math.max(12, height * 120),
      64 + Math.sin(angle * 0.5) * 40,
    );
    const daylight = Math.max(0, height);
    this.sun.intensity = 0.25 + 1.35 * daylight;
    this.ambient.intensity = 0.35 + 0.35 * daylight;
    const nightBlend = 1 - daylight;
    (this.scene.background as Color).setRGB(
      0.53 - 0.4 * nightBlend,
      0.71 - 0.5 * nightBlend,
      0.84 - 0.5 * nightBlend,
    );
  }

  getFps(): number {
    return this.fps;
  }
}
