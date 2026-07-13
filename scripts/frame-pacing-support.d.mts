import type { EventEmitter } from 'node:events';

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T>;
export function parseNamedArgs(argv: readonly string[]): Map<string, string>;
export function summarize(values: readonly number[]): {
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number | undefined;
};
export function maximumConsecutiveAbove(values: readonly number[], threshold: number): number;
export function terminateProcessTree(
  child: { readonly pid?: number },
  options?: {
    readonly platform?: NodeJS.Platform;
    readonly timeoutMs?: number;
    readonly taskkill?: (pid: number) => { readonly status: number | null; readonly error?: Error };
    readonly killProcessGroup?: (pid: number) => void;
  },
): void;
export function superviseChildTree<T>(
  child: { readonly exitCode: number | null; readonly signalCode: string | null },
  operation: Promise<T>,
  options: {
    readonly terminate: () => void;
    readonly host?: EventEmitter;
    readonly reraiseSignal?: (signal: 'SIGINT' | 'SIGTERM') => void;
    readonly onTerminationError?: (error: unknown) => void;
  },
): Promise<T>;
export function waitForChild(
  child: EventEmitter,
  options: { timeoutMs: number; label: string; onTimeout: () => void },
): Promise<void>;
export function waitForProcessExit(
  child: EventEmitter & { readonly exitCode: number | null; readonly signalCode: string | null },
  options: { timeoutMs: number; label: string },
): Promise<void>;
export function runCleanupTasks(
  tasks: ReadonlyArray<() => Promise<unknown>>,
  label: string,
): Promise<void>;
export function assertStableTree(before: string, after: string, message: string): void;
export function assertFreshBuildOutput(
  shouldBuild: boolean,
  distDirectory: string,
  defaultDistDirectory: string,
): void;
export function simulationAccepted(input: {
  speed: number;
  startSpeed: number;
  endSpeed: number;
  tickDelta: number;
  tickRate: number;
  minimumTickRate: number;
}): boolean;
export function freshBuildGateAccepted(
  shouldBuild: boolean,
  cases: ReadonlyArray<{ accepted: boolean }>,
): boolean;
