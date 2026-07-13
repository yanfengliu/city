export async function withTimeout(promise, timeoutMs, label) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseNamedArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`expected --name value, received ${String(key)} ${String(value)}`);
    }
    args.set(key.slice(2), value);
    index++;
  }
  return args;
}

export function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction) => sorted[Math.floor((sorted.length - 1) * fraction)];
  return {
    samples: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1),
  };
}

export function maximumConsecutiveAbove(values, threshold) {
  let current = 0;
  let maximum = 0;
  for (const value of values) {
    current = value > threshold ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

export function terminateProcessTree(child, options = {}) {
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('cannot terminate a child without a PID');
  const targetPlatform = options.platform ?? process.platform;
  if (targetPlatform === 'win32') {
    const runTaskkill = options.taskkill ?? ((ownedPid) => spawnSync(
      'taskkill',
      ['/pid', String(ownedPid), '/t', '/f'],
      { stdio: 'ignore', timeout: options.timeoutMs, windowsHide: true },
    ));
    const result = runTaskkill(pid);
    if (result.error) throw new Error(`taskkill failed for owned PID ${pid}`, { cause: result.error });
    if (result.status !== 0) {
      throw new Error(`taskkill exited ${String(result.status)} for owned PID ${pid}`);
    }
    return;
  }
  const killProcessGroup = options.killProcessGroup
    ?? ((ownedPid) => process.kill(-ownedPid, 'SIGKILL'));
  killProcessGroup(pid);
}

export async function superviseChildTree(child, operation, options) {
  const host = options.host ?? process;
  const terminateIfRunning = () => {
    if (child.exitCode === null && child.signalCode === null) options.terminate();
  };
  const detach = () => {
    host.off('exit', onExit);
    host.off('SIGINT', onSigint);
    host.off('SIGTERM', onSigterm);
  };
  const handleSignal = (signal) => {
    let terminationError;
    try {
      terminateIfRunning();
    } catch (error) {
      terminationError = error;
    }
    detach();
    if (terminationError) options.onTerminationError?.(terminationError);
    (options.reraiseSignal ?? ((value) => process.kill(process.pid, value)))(signal);
  };
  const onExit = () => terminateIfRunning();
  const onSigint = () => handleSignal('SIGINT');
  const onSigterm = () => handleSignal('SIGTERM');
  host.once('exit', onExit);
  host.once('SIGINT', onSigint);
  host.once('SIGTERM', onSigterm);
  try {
    return await operation;
  } finally {
    detach();
  }
}

export async function waitForChild(child, { timeoutMs, label, onTimeout }) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
      try {
        onTimeout();
        finish(timeoutError);
      } catch (cleanupError) {
        finish(new AggregateError(
          [timeoutError, cleanupError],
          `${label} timeout cleanup failed`,
        ));
      }
    }, timeoutMs);
    child.once('error', finish);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(
        `${label} failed with ${signal ? `signal ${signal}` : `exit ${String(code)}`}`,
      ));
    });
  });
}

export async function waitForProcessExit(child, { timeoutMs, label }) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await withTimeout(new Promise((resolve, reject) => {
    const finish = (error) => {
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = (error) => finish(error);
    child.once('exit', onExit);
    child.once('error', onError);
    if (child.exitCode !== null || child.signalCode !== null) finish();
  }), timeoutMs, label);
}

export async function runCleanupTasks(tasks, label) {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (errors.length > 0) throw new AggregateError(errors, label);
}

export function assertStableTree(before, after, message) {
  if (before !== after) throw new Error(message);
}

export function assertFreshBuildOutput(shouldBuild, distDirectory, defaultDistDirectory) {
  if (
    shouldBuild
    && distDirectory.toLowerCase() !== defaultDistDirectory.toLowerCase()
  ) {
    throw new Error('custom --dist requires --build false; npm run build only writes the default dist');
  }
}

export function simulationAccepted({
  speed,
  startSpeed,
  endSpeed,
  tickDelta,
  tickRate,
  minimumTickRate,
}) {
  if (speed === 0) return startSpeed === 0 && endSpeed === 0 && tickDelta === 0;
  return startSpeed === speed && endSpeed === speed && tickRate >= minimumTickRate;
}

export function freshBuildGateAccepted(shouldBuild, cases) {
  return shouldBuild && cases.every((entry) => entry.accepted);
}
import { spawnSync } from 'node:child_process';
import process from 'node:process';
