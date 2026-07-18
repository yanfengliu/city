import { createConnection, createServer } from 'node:net';

export const HOST_BENCHMARK_LEASE_PORT = 47_831;
export const LEASE_OWNER_READ_TIMEOUT_MS = 1_000;

async function readLeaseOwner(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let body = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('lease owner read timed out')));
    socket.on('data', (chunk) => { body += chunk; });
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(
          `lease owner at ${host}:${port} returned unparseable metadata: ${JSON.stringify(body.slice(0, 200))}`,
          { cause: error },
        ));
      }
    });
  });
}

/**
 * Acquires an OS-owned loopback lease. The socket closes automatically if its
 * process dies, so crashed benchmark owners never leave a stale lock behind.
 */
export async function acquireLoopbackLease({ host, port, owner, ownerReadTimeoutMs }) {
  const payload = `${JSON.stringify(owner)}\n`;
  const server = createServer((socket) => socket.end(payload));
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error;
    const currentOwner = await readLeaseOwner(host, port, ownerReadTimeoutMs).catch(() => null);
    const detail = currentOwner?.pid
      ? `PID ${String(currentOwner.pid)} since ${String(currentOwner.capturedAt ?? 'unknown')}`
      : `an unrecognized process on ${host}:${port}`;
    throw new Error(`frame-pacing benchmark already owned by ${detail}`);
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('benchmark lease has no TCP port');
  let released = false;
  return {
    owner,
    port: address.port,
    async release() {
      if (released) return;
      released = true;
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
