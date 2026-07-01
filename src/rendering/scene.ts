import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { GRID_HEIGHT, GRID_WIDTH } from '../sim/constants/map';

/** Owns the Three.js scene graph, camera, and render loop. */
export class CityScene {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: MapControls;
  private fps = 0;
  private frameCount = 0;
  private lastFpsSample = performance.now();

  constructor(container: HTMLElement) {
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
    this.camera.position.set(GRID_WIDTH / 2, 60, GRID_HEIGHT / 2 + 60);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(GRID_WIDTH / 2, 0, GRID_HEIGHT / 2);
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 220;
    this.controls.update();

    const ambient = new AmbientLight(0xffffff, 0.7);
    const sun = new DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(80, 120, 40);
    this.scene.add(ambient, sun);

    // Placeholder ground; replaced by generated terrain in phase 1.
    const ground = new Mesh(
      new PlaneGeometry(GRID_WIDTH, GRID_HEIGHT),
      new MeshLambertMaterial({ color: 0x6ea564 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(GRID_WIDTH / 2, 0, GRID_HEIGHT / 2);
    this.scene.add(ground);

    window.addEventListener('resize', () => {
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });

    this.renderer.setAnimationLoop(() => this.renderFrame());
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
