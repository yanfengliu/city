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
  private fps = 0;
  private frameCount = 0;
  private lastFpsSample = performance.now();

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

    const ambient = new AmbientLight(0xffffff, 0.7);
    const sun = new DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(80, 120, 40);
    this.scene.add(ambient, sun);

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

  getFps(): number {
    return this.fps;
  }
}
