import type { Browser, BrowserServer } from '@playwright/test';
import type { FramePacingHttpServer } from './frame-pacing-http.mjs';

export function cleanupBrowserResources(options: {
  readonly browser?: Browser;
  readonly browserServer?: BrowserServer;
  readonly httpServers: readonly FramePacingHttpServer[];
  readonly cleanupTimeoutMs: number;
}): Promise<void>;
