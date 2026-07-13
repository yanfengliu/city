import { describe, expect, it } from 'vitest';
import { acquireLoopbackLease } from '../../scripts/frame-pacing-lease.mjs';

const owner = (pid: number) => ({
  pid,
  capturedAt: '2026-07-13T00:00:00.000Z',
  purpose: 'test',
});

describe('frame-pacing loopback lease', () => {
  it('reports the active owner and becomes reusable after release', async () => {
    const first = await acquireLoopbackLease({
      host: '127.0.0.1',
      port: 0,
      owner: owner(123),
      ownerReadTimeoutMs: 1_000,
    });
    await expect(acquireLoopbackLease({
      host: '127.0.0.1',
      port: first.port,
      owner: owner(456),
      ownerReadTimeoutMs: 1_000,
    })).rejects.toThrow('already owned by PID 123');
    await first.release();

    const next = await acquireLoopbackLease({
      host: '127.0.0.1',
      port: first.port,
      owner: owner(456),
      ownerReadTimeoutMs: 1_000,
    });
    expect(next.port).toBe(first.port);
    await next.release();
  });
});
