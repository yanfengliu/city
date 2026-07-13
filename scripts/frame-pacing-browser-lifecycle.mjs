import { closeHttpServer } from './frame-pacing-http.mjs';
import {
  runCleanupTasks,
  waitForProcessExit,
  withTimeout,
} from './frame-pacing-support.mjs';

async function closeBrowserServer(browserServer, cleanupTimeoutMs) {
  const child = browserServer.process();
  try {
    await withTimeout(browserServer.close(), cleanupTimeoutMs, 'benchmark browser cleanup');
    await waitForProcessExit(child, {
      timeoutMs: cleanupTimeoutMs,
      label: 'benchmark browser process exit',
    });
  } catch (error) {
    let forcedError;
    try {
      await withTimeout(
        browserServer.kill(),
        cleanupTimeoutMs,
        'forced benchmark browser cleanup',
      );
      await waitForProcessExit(child, {
        timeoutMs: cleanupTimeoutMs,
        label: 'forced benchmark browser process exit',
      });
    } catch (forceFailure) {
      forcedError = forceFailure;
    }
    if (forcedError) {
      throw new AggregateError([error, forcedError], 'benchmark browser cleanup failed');
    }
    throw error;
  }
}

export async function cleanupBrowserResources({
  browser,
  browserServer,
  httpServers,
  cleanupTimeoutMs,
}) {
  await runCleanupTasks([
    async () => {
      let connectionError;
      if (browser) {
        try {
          await withTimeout(browser.close(), cleanupTimeoutMs, 'browser connection cleanup');
        } catch (error) {
          connectionError = error;
        }
      }
      if (browserServer) await closeBrowserServer(browserServer, cleanupTimeoutMs);
      if (connectionError) throw connectionError;
    },
    ...httpServers.map((server) => () => closeHttpServer(server, cleanupTimeoutMs)),
  ], 'benchmark resource cleanup failed');
}
