import {
  AmbientLight,
  Color,
  DirectionalLight,
  MOUSE,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Object3D, Vector3 } from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

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
  private fps = 0;
  private frameCount = 0;
  private lastFpsSample = performance.now();
  private readonly frameCallbacks: Array<() => void> = [];

  constructor(container: HTMLElement, gridWidth: number, gridHeight: number) {
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
   * (zoom) and right (rotate) always stay with MapControls.
   */
  setLeftDragEnabled(enabled: boolean): void {
    this.controls.mouseButtons.LEFT = enabled ? MOUSE.PAN : null;
  }

  getCameraTarget(): Vector3 {
    return this.controls.target;
  }

  private renderFrame(): void {
    for (const callback of this.frameCallbacks) callback();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
    const now = performance.now();
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
