export interface FramePacingHttpServer {
  readonly url: string;
  close(): Promise<void>;
  forceClose(): void;
}

export function serveDist(directory: string): Promise<FramePacingHttpServer>;
export function closeHttpServer(
  server: FramePacingHttpServer,
  cleanupTimeoutMs: number,
): Promise<void>;
