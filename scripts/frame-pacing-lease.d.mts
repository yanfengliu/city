export const HOST_BENCHMARK_LEASE_PORT: 47831;
export const LEASE_OWNER_READ_TIMEOUT_MS: 1000;

export interface LoopbackLeaseOwner {
  readonly pid: number;
  readonly capturedAt: string;
  readonly purpose: string;
}

export interface LoopbackLease {
  readonly owner: LoopbackLeaseOwner;
  readonly port: number;
  release(): Promise<void>;
}

export function acquireLoopbackLease(options: {
  readonly host: string;
  readonly port: number;
  readonly owner: LoopbackLeaseOwner;
  readonly ownerReadTimeoutMs: number;
}): Promise<LoopbackLease>;
