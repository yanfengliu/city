import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertFreshBuildOutput,
  assertStableTree,
  freshBuildGateAccepted,
  maximumConsecutiveAbove,
  parseNamedArgs,
  runCleanupTasks,
  simulationAccepted,
  superviseChildTree,
  summarize,
  terminateProcessTree,
  waitForChild,
  waitForProcessExit,
  withTimeout,
} from '../../scripts/frame-pacing-support.mjs';

describe('frame-pacing benchmark support', () => {
  afterEach(() => vi.useRealTimers());

  it('parses named arguments and summarizes raw samples', () => {
    expect(parseNamedArgs(['--dist', 'dist-test', '--build', 'false'])).toEqual(
      new Map([['dist', 'dist-test'], ['build', 'false']]),
    );
    expect(() => parseNamedArgs(['--dist'])).toThrow('expected --name value');
    expect(summarize([10, 20, 30, 40])).toEqual({
      samples: 4,
      mean: 25,
      p50: 20,
      p95: 30,
      p99: 30,
      max: 40,
    });
    expect(maximumConsecutiveAbove([19, 21, 22, 18, 23], 20)).toBe(2);
  });

  it('times out a wedged operation and a spawned child through executable seams', async () => {
    vi.useFakeTimers();
    const operation = withTimeout(new Promise<never>(() => {}), 50, 'operation');
    const child = new EventEmitter();
    const onTimeout = vi.fn();
    const childWait = waitForChild(child, { timeoutMs: 75, label: 'build', onTimeout });
    const operationExpectation = expect(operation).rejects.toThrow(
      'operation timed out after 50ms',
    );
    const childExpectation = expect(childWait).rejects.toThrow(
      'build timed out after 75ms',
    );

    await vi.advanceTimersByTimeAsync(50);
    await operationExpectation;
    await vi.advanceTimersByTimeAsync(25);
    await childExpectation;
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('checks Windows tree termination and targets the POSIX process group', () => {
    const taskkill = vi.fn(() => ({ status: 0 }));
    terminateProcessTree({ pid: 321 }, { platform: 'win32', taskkill });
    expect(taskkill).toHaveBeenCalledExactlyOnceWith(321);
    expect(() => terminateProcessTree(
      { pid: 321 },
      { platform: 'win32', taskkill: () => ({ status: 1 }) },
    )).toThrow('taskkill exited 1 for owned PID 321');

    const killProcessGroup = vi.fn();
    terminateProcessTree({ pid: 654 }, { platform: 'linux', killProcessGroup });
    expect(killProcessGroup).toHaveBeenCalledExactlyOnceWith(654);
  });

  it('terminates an active build tree on parent exit and removes supervision afterward', async () => {
    const host = new EventEmitter();
    const child = { exitCode: null, signalCode: null };
    const terminate = vi.fn();
    let finishOperation: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => { finishOperation = resolve; });
    const supervised = superviseChildTree(child, operation, { host, terminate });

    host.emit('exit', 1);
    expect(terminate).toHaveBeenCalledOnce();
    finishOperation?.();
    await supervised;
    expect(host.listenerCount('exit')).toBe(0);
    expect(host.listenerCount('SIGINT')).toBe(0);
    expect(host.listenerCount('SIGTERM')).toBe(0);
  });

  it('waits for the owned process to actually exit', async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as string | null,
    });
    const exited = waitForProcessExit(child, { timeoutMs: 1_000, label: 'owned browser' });
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await expect(exited).resolves.toBeUndefined();
  });

  it('attempts every independent cleanup even when one fails', async () => {
    const calls: string[] = [];
    await expect(runCleanupTasks([
      async () => {
        calls.push('browser');
        throw new Error('browser failed');
      },
      async () => {
        calls.push('server');
      },
    ], 'cleanup failed')).rejects.toThrow('cleanup failed');
    expect(calls).toEqual(['browser', 'server']);
  });

  it('rejects moving inputs, custom fresh-build outputs, and skipped-build certification', () => {
    expect(() => assertStableTree('before', 'after', 'source moved')).toThrow('source moved');
    expect(() => assertFreshBuildOutput(true, 'custom', 'dist')).toThrow(
      'custom --dist requires --build false',
    );
    expect(() => assertFreshBuildOutput(false, 'custom', 'dist')).not.toThrow();
    expect(freshBuildGateAccepted(false, [{ accepted: true }])).toBe(false);
    expect(freshBuildGateAccepted(true, [{ accepted: true }])).toBe(true);
    expect(freshBuildGateAccepted(true, [{ accepted: false }])).toBe(false);
  });

  it('requires a genuinely paused state and active-speed throughput', () => {
    expect(simulationAccepted({
      speed: 0,
      startSpeed: 0,
      endSpeed: 0,
      tickDelta: 0,
      tickRate: 0,
      minimumTickRate: 0,
    })).toBe(true);
    expect(simulationAccepted({
      speed: 0,
      startSpeed: 1,
      endSpeed: 1,
      tickDelta: 0,
      tickRate: 0,
      minimumTickRate: 0,
    })).toBe(false);
    expect(simulationAccepted({
      speed: 4,
      startSpeed: 4,
      endSpeed: 4,
      tickDelta: 800,
      tickRate: 80,
      minimumTickRate: 72,
    })).toBe(true);
  });
});
