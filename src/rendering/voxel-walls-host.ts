import type { Camera, Scene, WebGLRenderer } from 'three';
import { ThreeRenderRuntime, type ThreePreparedFrameTicket } from 'voxel/three';

import type { BuildingRenderView } from './buildings-mesh';
import type { TerrainSurfaceView } from './terrain-surface';
import { VoxelWallsLane } from './voxel-walls-lane';

export const VOXEL_WALLS_PARAM = 'voxelWalls';

/** `?voxelWalls=1` opts one session into the Voxel-rendered wall lane. */
export function voxelWallsRequested(search: string): boolean {
  return new URLSearchParams(search).get(VOXEL_WALLS_PARAM) === '1';
}

export interface VoxelWallsHostOptions {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
}

/**
 * Hosts the Voxel runtime that draws City's building walls.
 *
 * City keeps every ownership it already had: it owns the renderer, the
 * camera, the viewport, capture, shadow policy, and the draw itself. Voxel
 * runs embedded, contributing only its own scene root, and learns that its
 * work reached the canvas through City's after-frame acknowledgement.
 *
 * A Voxel failure must never take the city down with it. Every boundary call
 * is contained: on failure the host goes inert and City keeps rendering, which
 * is exactly what the A/B flag is for.
 */
export class VoxelWallsHost {
  private readonly lane = new VoxelWallsLane();
  private readonly runtime: ThreeRenderRuntime;
  private ticket: ThreePreparedFrameTicket | null = null;
  private frameIndex = 0;
  private lastNowMs: number | null = null;
  private failed = false;

  constructor(options: VoxelWallsHostOptions) {
    this.runtime = new ThreeRenderRuntime({
      host: {
        kind: 'embedded',
        renderer: options.renderer,
        scene: options.scene,
        camera: options.camera,
        drawOwnership: 'host',
        viewportOwnership: 'host',
        captureOwnership: 'host',
      },
      width: options.width,
      height: options.height,
    });
  }

  get isInert(): boolean {
    return this.failed;
  }

  upsert(view: BuildingRenderView): void {
    this.lane.upsert(view);
  }

  remove(id: number): void {
    this.lane.remove(id);
  }

  setTerrainSurface(surface: TerrainSurfaceView): void {
    this.lane.setTerrainSurface(surface);
  }

  /** Prepares Voxel's scene changes for City's imminent draw. */
  prepareFrame(nowMs: number): void {
    if (this.failed) return;
    try {
      const snapshot = this.lane.snapshotIfDirty();
      if (snapshot) {
        const applied = this.runtime.acceptSnapshot(snapshot);
        if (applied.status !== 'accepted') {
          throw new Error(`Voxel rejected the wall lane: ${applied.code} at ${applied.path}`);
        }
      }
      const deltaMs = this.lastNowMs === null ? 0 : Math.max(0, nowMs - this.lastNowMs);
      this.lastNowMs = nowMs;
      const prepared = this.runtime.prepareFrame({
        nowMs,
        deltaMs,
        frameIndex: this.frameIndex,
      });
      // 'unavailable' is a normal context-loss outcome, not a failure: City
      // simply draws this frame without a Voxel presentation.
      this.ticket = prepared.status === 'prepared' ? prepared.ticket : null;
      if (this.ticket) this.frameIndex += 1;
    } catch (error) {
      this.goInert('preparing the voxel wall frame', error);
    }
  }

  /** Acknowledges City's completed draw so Voxel may call the revision presented. */
  commitFrame(): void {
    const ticket = this.ticket;
    this.ticket = null;
    if (!ticket || this.failed) return;
    try {
      this.runtime.commitFrame(ticket);
    } catch (error) {
      this.goInert('committing the voxel wall frame', error);
    }
  }

  dispose(): void {
    this.abortPendingTicket();
    try {
      this.runtime.dispose();
    } catch (error) {
      console.error('voxel wall runtime disposal failed', error);
    }
  }

  private abortPendingTicket(): void {
    const ticket = this.ticket;
    this.ticket = null;
    if (!ticket) return;
    try {
      this.runtime.abortFrame(ticket);
    } catch {
      // Disposal and failure paths already own the outcome.
    }
  }

  private goInert(what: string, error: unknown): void {
    this.failed = true;
    console.error(`${what} failed; the voxel wall lane is now inert`, error);
    this.abortPendingTicket();
  }
}
